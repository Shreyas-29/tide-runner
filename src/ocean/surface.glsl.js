/* the sea surface's shaders, built from the cascade sizes and the wake's GLSL chunks */

export const surfaceVertex = ({ N, Ls, chunks })=>chunks + /* glsl */`
  uniform sampler2D tD0, tD1, tD2; uniform vec2 uCenter;
  varying vec3 vW; varying vec2 vG;
  float lodFor(float sp, float L){ return max(log2(2.*sp/(L/${N}.)), 0.); }
  void main(){
    vec2 g = position.xz + uCenter;
    float sp = max(length(position.xz)*.02, .006);
    vec3 d = textureLod(tD0, g/${Ls[0]}, lodFor(sp, ${Ls[0]})).xyz
           + textureLod(tD1, g/${Ls[1]}, lodFor(sp, ${Ls[1]})).xyz
           + textureLod(tD2, g/${Ls[2]}, lodFor(sp, ${Ls[2]})).xyz*(1. - smoothstep(.15, .6, sp));
    vW = vec3(g.x + d.x, d.y, g.y + d.z); vG = g;
    vW.y += wakeWaves(wakeTap(g), sp).x*wakeIn(g) + dynH(g);   /* the boat's wake and its dynamic waves ride on the sea */
    gl_Position = projectionMatrix*viewMatrix*vec4(vW, 1.);
  }`;

export const surfaceFragment = ({ N, Ls, chunks })=>chunks + /* glsl */`
  uniform sampler2D tD0, tD1, tD2, tN0, tN1, tN2, tF0, tF1, tF2, tSS;
  uniform vec3 uSunDir, uSunCol, uZen, uHor, uScatter, uSSS, uLampPos, uLampCol; uniform float uHs, uTime, uCover, uSSOK, uDbg; uniform mat4 uVPRot;
  uniform mat4 uBoatInv, uReflMat; uniform float uBoatOn, uReflY; uniform sampler2D tRefl;
  varying vec3 vW; varying vec2 vG;
  float fres(float c){ float x = 1. - clamp(c, 0., 1.), x2 = x*x; return .02 + .98*x2*x2*x; }
  /* the hull's lines (boat model): is this point of the sea inside the hull? */
  bool inHull(vec3 w){
    vec3 p = (uBoatInv*vec4(w, 1.)).xyz;
    if(p.z < -8. || p.z > 9. || abs(p.x) > 2.6) return false;
    float t = clamp((p.z + 8.)/16., 0., 1.);
    float keel = -.85 + 1.4*pow(smoothstep(.45, 1., t), 2.1);
    t = clamp((p.z - (p.y - keel)*.42*smoothstep(.8, 1., t) + 8.)/16., 0., 1.);   /* undo the stem's rake */
    keel = -.85 + 1.4*pow(smoothstep(.45, 1., t), 2.1);
    float u = max(0., (t - .6)/.4), sx = 2.5*pow(max(0., 1. - pow(u, 1.6)), .7), sy = 1.55 + .75*pow(t, 1.8);
    float cx = t < .35 ? 2.2 : 2.2*pow(max(0., 1. - pow((t - .35)/.65, 1.9)), .75), cy = -.2 + .85*pow(smoothstep(.3, 1., t), 1.5);
    if(p.y < keel) return false;
    float hb = p.y < cy ? cx*(p.y - keel)/max(cy - keel, 1e-3)
                        : (p.y < sy ? cx + (sx - cx)*pow(clamp((p.y - cy)/(sy - cy), 0., 1.), 1. + .9*smoothstep(.45, .95, t)) : sx);
    return abs(p.x) < hb;
  }
  vec3 skyFallback(vec3 r){ return mix(uHor, uZen, pow(clamp(r.y, 0., 1.), .5)); }
  /* B-spline bicubic from four bilinear taps: magnified normal maps stay smooth, so glints are not polygons */
  vec4 tex3(sampler2D t, vec2 uv){
    vec2 st = uv*${N}. - .5, i = floor(st), f = st - i, f2 = f*f, f3 = f2*f;
    vec2 w0 = (1. - 3.*f + 3.*f2 - f3)/6., w1 = (4. - 6.*f2 + 3.*f3)/6., w2 = (1. + 3.*f + 3.*f2 - 3.*f3)/6., w3 = f3/6.;
    vec2 g0 = w0 + w1, g1 = w2 + w3, p0 = (i + .5 - 1. + w1/g0)/${N}., p1 = (i + .5 + 1. + w3/g1)/${N}.;
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    return g0.y*(g0.x*textureGrad(t, vec2(p0.x, p0.y), dx, dy) + g1.x*textureGrad(t, vec2(p1.x, p0.y), dx, dy))
         + g1.y*(g0.x*textureGrad(t, vec2(p0.x, p1.y), dx, dy) + g1.x*textureGrad(t, vec2(p1.x, p1.y), dx, dy));
  }
  /* a GGX-like lobe for a light along L, shared by the sun and the boat's lamp */
  float lobe(vec3 N, vec3 V, vec3 L, float sg){
    vec3 H = normalize(L + V); float nh = max(dot(N, H), 1e-3), t2 = (1. - nh*nh)/(nh*nh);
    return fres(dot(V, H))*exp(-t2/(2.*sg))/(6.2832*sg*nh*nh*nh*nh);
  }
  void main(){
    if(uBoatOn > .5 && inHull(vW)) discard;   /* no sea inside the boat */
    vec2 u0 = vG/${Ls[0]}, u1 = vG/${Ls[1]}, u2 = vG/${Ls[2]};
    float fp = length(fwidth(vG));

    /* the wake: Kelvin waves from the path coordinates, then the churned foam */
    vec4 wgx, wgz, wk = wakeTap(vG, wgx, wgz); float win = wakeIn(vG);
    float wAge = uWakeNow.y - wk.b, wash = clamp(wk.a, 0., 1.5)*win;
    float wFresh = smoothstep(1.05, 1.45, wash);   /* fresh = densest foam (it decays as it ages): no timestamp, so no line where the track began */
    vec2 wSlope = vec2(0.); float wH = 0.;
    if(win > 0. && wAge < 400.){
      vec3 ww = wakeWaves(wk, fp); wH = ww.x*win;
      vec2 gD = -vec2(wgx.r, wgz.r), gY = vec2(wgx.g, wgz.g);   /* chain rule: the path coordinates' gradients */
      gD /= max(1., length(gD)); gY /= max(1., length(gY));   /* seams where a newer pass overwrote an older one */
      wSlope = (ww.y*gD + ww.z*gY)*win;
      wSlope /= max(1., length(wSlope)/.18);   /* no glassy mirror facets on the steepest wake crests */
    }
    /* boils in the fresh prop wash */
    wSlope += (vec2(vnoise(vG*.55 + uTime*.3), vnoise(vG*.55 + 9.1 - uTime*.3)) - .5)*.2*wFresh;
    /* the dynamic waves near the boat: slope by central differences, whitecaps on the steep crests */
    float dE = uDynRect.w, dh = dynH(vG);
    vec2 dS = vec2(dynH(vG + vec2(dE, 0.)) - dynH(vG - vec2(dE, 0.)), dynH(vG + vec2(0., dE)) - dynH(vG - vec2(0., dE)))/(2.*dE);
    wSlope += dS*1.8; wH += dh;   /* real crests are sharper than the linear sim: steepen them for the light */
    float dynFoam = smoothstep(.12, .4, length(dS))*smoothstep(.03, .14, dh);
    float slick = clamp(wash*1.6, 0., 1.)*(1. - wFresh)*.1;   /* the churned strip smooths a little: ripples damped */

    vec4 d = texture(tN0, u0) + tex3(tN1, u1) + tex3(tN2, u2)*(1. - slick);   /* Dyx Dyz Dxx Dzz */
    float dxz = texture(tD0, u0).w + texture(tD1, u1).w + texture(tD2, u2).w;
    vec2 slope = vec2(d.x/(1. + d.z), d.y/(1. + d.w)) + wSlope;
    vec3 N = normalize(vec3(-slope.x, 1., -slope.y));
    float J = (1. + d.z)*(1. + d.w) - dxz*dxz;

    vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC/dist;
    vec3 L = uSunDir, sunC = uSunCol;
    float s2 = .0022 + .0026*smoothstep(30., 800., dist) + min(.014, .006*fp*fp + .002*fp);

    vec3 nF = normalize(mix(N, vec3(0., 1., 0.), .4));
    float F = fres(dot(nF, V));
    float sig = sqrt(s2);
    vec3 vh = normalize(vec3(V.x, 0., V.z) + 1e-5);
    vec3 nV = normalize(N + vh*.32*sig*(1. - smoothstep(0., .35, V.y)));
    vec3 R = reflect(-V, nV); R.y = abs(R.y)*.4 + max(R.y, 0.)*.6; R = normalize(R);

    /* the reflected sky, clouds and all: last frame's sky where the reflected direction is on screen.
       Rough water never mirrors cleanly: the far sea blurs and stretches what it reflects; directions above
       the top of the screen borrow the top of the sky (well blurred) rather than switching to a fallback */
    vec3 refl = skyFallback(R);
    vec4 clip = uVPRot*vec4(R, 0.);
    if(clip.w > 0. && uSSOK > .5){
      vec2 suv = clip.xy/clip.w*.5 + .5;
      float lod = mix(1.5, 4.5, smoothstep(150., 4000., dist)) + 1.5*smoothstep(.95, 1.4, suv.y);
      vec2 q = vec2(clamp(suv.x, .01, .99), clamp(suv.y, .01, .95));
      float vs = .012*(1. + 3.*smoothstep(150., 4000., dist));        /* vertical streaking */
      vec4 s4 = (textureLod(tSS, q, lod)*2. + textureLod(tSS, q + vec2(0., vs), lod) + textureLod(tSS, q - vec2(0., vs), lod))*.25;
      vec3 ss = s4.rgb/max(s4.a, 1e-3);
      ss = min(ss, vec3(max(max(uZen.r, uZen.b), max(uHor.r, uHor.b))*12.));      /* the sun's disc is the glint's job */
      float k = smoothstep(-.1, .05, suv.x)*(1. - smoothstep(.95, 1.1, suv.x))*(1. - smoothstep(1.2, 1.9, suv.y))*smoothstep(.04, .3, s4.a);
      refl = mix(refl, ss, k);
    }

    /* the boat mirrored in the sea: a planar reflection, broken up by the waves */
    if(uBoatOn > .5){
      vec2 rn = N.xz/max(1., length(N.xz)/.12);   /* bounded wobble: steep wake slopes would tear the mirror into pixels */
      vec4 rc = uReflMat*vec4(vW.x + rn.x*2.2, uReflY, vW.z + rn.y*2.2, 1.);
      vec2 ruv = rc.xy/rc.w;
      if(rc.w > 0. && all(greaterThan(ruv, vec2(0.))) && all(lessThan(ruv, vec2(1.)))){
        vec4 br = texture(tRefl, ruv);
        refl = mix(refl, br.rgb/max(br.a, 1e-3), clamp(br.a, 0., 1.)*.92*(1. - .8*clamp(wash, 0., 1.)));
      }
    }

    float nl = dot(N, L), nv = max(dot(N, V), 1e-3);
    float sg = s2 + 2.5e-5;
    vec3 H = normalize(L + V);
    float lv = sqrt(sg)*sqrt(max(1. - V.y*V.y, 0.))/max(V.y, .02), ll = sqrt(sg)*sqrt(max(1. - L.y*L.y, 0.))/max(L.y, .02);
    float Gm = 1./(1. + .5*lv*lv + .5*ll*ll);
    vec3 spec = sunC*lobe(N, V, L, sg)*Gm/(4.*max(V.y, .02))*step(0., L.y)*step(0., nl)*(1. - .6*uCover);
    /* glitter: unresolved facets are tiny mirrors flashing in turn; only where the cells are smaller than a pixel */
    vec2 gcell = floor(vG/max(fp*1.4, .12));
    float tw = hash12(gcell + floor(uTime*6.)*vec2(17.13, 31.7));
    spec *= mix(1., pow(tw, 5.)*6., .3*smoothstep(.07, .14, fp*1.4));

    vec3 skyHemi = mix(uHor, uZen, .5)*(.6 + .4*N.y);
    vec3 body = uScatter*(skyHemi*(.7 + .9*N.y) + sunC*(max(L.y, 0.)*.16 + max(nl, 0.)*.12)*(1. - .5*uCover));
    float crest = clamp((vW.y - .05*uHs)/(.45*uHs + .05), 0., 1.);
    float toSun = max(dot(L, -V), 0.), thin = pow(clamp(.5 - .5*dot(L, N), 0., 1.), 3.);
    body += uSSS*sunC*crest*crest*pow(toSun, 4.)*thin*exp(-dist/600.)*1.2;
    body += uSSS*sunC*.12*pow(nv, 2.)*.1;
    body *= .55 + .9*clamp(vW.y/(uHs + .1) + .45, 0., 1.);

    float fm = texture(tF0, u0).r + texture(tF1, u1).r*.8 + texture(tF2, u2).r*.35;
    float fresh = clamp((.62 - J)*1.8, 0., 1.);
    float bub = vnoise(vG*1.7 + uTime*.05)*.55 + vnoise(vG*4.9 - uTime*.07)*.3 + vnoise(vG*13.)*.15;
    float cover = max(fm, fresh);
    float foam = clamp(cover*smoothstep(.0, .5, cover)*(.55 + .7*bub) - .1, 0., 1.)*(1. - smoothstep(800., 3000., dist)*.6);
    body += uSSS*(sunC*.05 + skyHemi*.35)*clamp(cover, 0., 1.);
    vec3 foamLit = vec3(.82, .87, .92)*(.78 + .3*bub)*(sunC*max(dot(N, L), 0.)*.16 + skyHemi*1.55);

    /* wake foam: solid churn behind the transom that tears into lace, streaked along the track, then patches */
    if(wash > .004){
      vec2 wq = vG + (vec2(vnoise(vG*.19), vnoise(vG*.19 + 5.2)) - .5)*7.;
      float lace = vnoise(wq*.35)*.5 + vnoise(wq*1.1 + uTime*.04)*.3 + vnoise(wq*3.3)*.2;
      float streak = vnoise(vec2(wk.r*.07, wk.g*.75))*.6 + vnoise(vec2(wk.r*.2, wk.g*2.2))*.4;
      float wc = clamp(wash*.45 + wFresh*.55, 0., .92), wn = mix(lace, streak, .35);
      float wt = mix(.72, .3, wc), wf = smoothstep(wt, wt + .16, wn + .1*bub - .05)*smoothstep(.02, .15, wc);
      wf = max(wf, wc*.16*(.4 + bub));   /* a thin film of bubbles between the patches */
      wf = mix(wf, wc*.7, smoothstep(.4, 2.5, fp))*mix(.8, 1., wFresh)*(1. - smoothstep(800., 3000., dist)*.6);
      foam = max(foam, wf*win);
    }
    foam = max(foam, dynFoam*smoothstep(.35, .75, bub + .25*dynFoam)*.85);   /* the bow wave breaking: torn lace, not a sheet */
    body += uSSS*(sunC*.06 + skyHemi*.7)*clamp(wash, 0., 1.)*.8;   /* aerated water under the wash glows turquoise */

    /* the boat's lamp on the water at night: its glint dancing on the waves, and a little light into the water */
    vec3 lamp = vec3(0.);
    if(uLampCol.r + uLampCol.g + uLampCol.b > 0.){
      vec3 Lp = uLampPos - vW; float ld = length(Lp); Lp /= ld;
      float fall = 1./(1. + ld*ld*.04);
      lamp = uLampCol*fall*(lobe(N, V, Lp, sg*1.6)*.25*step(0., dot(N, Lp)) + uScatter*max(dot(N, Lp), 0.)*6.);
    }

    spec *= 1. - .6*clamp(wash, 0., 1.);   /* churned, bubbly water scatters the light instead of mirroring it */
    vec3 col = body*(1. - F) + refl*F + (spec + lamp)*(1. - foam);
    col = mix(col, foamLit, clamp(foam, 0., 1.)*.95);
    if(uDbg > 5.5) col = vec3(max(dh, 0.), length(dS)*.3, max(-dh, 0.));
    else if(uDbg > 4.5) col = vec3(wash, max(wH, 0.), max(-wH, 0.))*.5;
    else if(uDbg > .5) col = uDbg < 1.5 ? refl*F : (uDbg < 2.5 ? body*(1. - F) : (uDbg < 3.5 ? vec3(F*.2) : spec));
    gl_FragColor = vec4(col, 1.);     /* linear radiance: the atmosphere pass adds the haze, then tone mapping */
  }`;
