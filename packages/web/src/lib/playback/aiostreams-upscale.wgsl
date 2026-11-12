//! name: upscale layer 0
//! shape: kernel
//! hook: PRESCALE
//! domain: source
//! when: output.height / source.height > 1.2 && !hdr.source
//! input: HOOKED
//! save: UPSCALE_0
//! output: HOOKED.size, rgba8unorm

// aiostreams-upscale, https://github.com/AIOStreams/media/tree/main/upscale
// SPDX-License-Identifier: MIT

fn kernel(coordinate: vec2f) -> vec4f {
    var r = vec4f(0.20397,0.00702953,-0.0865852,-0.313412);
    r += vec4f(-0.440169,-0.748692,0.763361,-0.324036) * dot(HOOKED_texOff(coordinate, vec2f(0.0, -1.0)).rgb, vec3f(0.299, 0.587, 0.114));
    r += vec4f(0.289696,-0.574033,-0.173657,-0.519338) * dot(HOOKED_texOff(coordinate, vec2f(-1.0, 0.0)).rgb, vec3f(0.299, 0.587, 0.114));
    r += vec4f(0.901201,1.05263,1.53109,-0.371025) * dot(HOOKED_texOff(coordinate, vec2f(0.0, 0.0)).rgb, vec3f(0.299, 0.587, 0.114));
    r += vec4f(0.159509,-0.324065,-0.281455,0.13455) * dot(HOOKED_texOff(coordinate, vec2f(1.0, 0.0)).rgb, vec3f(0.299, 0.587, 0.114));
    r += vec4f(-0.735704,1.0371,-0.759467,0.0281634) * dot(HOOKED_texOff(coordinate, vec2f(0.0, 1.0)).rgb, vec3f(0.299, 0.587, 0.114));
    return clamp(r, vec4f(0.0), vec4f(1.0));
}

//! name: upscale layer 1
//! shape: kernel
//! hook: PRESCALE
//! domain: source
//! when: output.height / source.height > 1.2 && !hdr.source
//! input: UPSCALE_0
//! save: UPSCALE_1
//! output: HOOKED.size, rgba8unorm

fn kernel(coordinate: vec2f) -> vec4f {
    var r = vec4f(-0.113016,-0.0856568,-0.0600659,0.0347607);
    r += mat4x4f(-0.0216843,0.277068,-0.162226,0.0304626,-0.0920142,-0.121932,-0.0716391,-0.074899,-0.0565642,-0.017127,-0.086497,-0.0337775,-0.00247695,0.00440774,-0.0073949,-0.00675742) * UPSCALE_0_texOff(coordinate, vec2f(0.0, -2.0));
    r += mat4x4f(-0.0332398,0.0682542,-0.00451692,-0.0160582,0.0287942,0.0106239,0.0118085,0.00492224,0.0138257,0.0510541,0.042227,-0.0262181,-0.00707781,0.00493724,0.00507474,0.00576055) * UPSCALE_0_texOff(coordinate, vec2f(-2.0, 0.0));
    r += mat4x4f(0.571144,0.0139022,0.435351,-0.107082,-0.304359,0.396147,0.260023,-0.191708,0.0665673,-0.270559,0.674107,-0.163708,0.00676889,0.00583675,0.00357812,0.469491) * UPSCALE_0_texOff(coordinate, vec2f(0.0, 0.0));
    r += mat4x4f(-0.0220475,0.0502398,-0.0930444,-0.104529,0.017711,0.0206805,0.0926629,0.228054,-0.0068994,-0.00419825,0.0667792,0.208847,-0.00510947,-0.00766995,-8.30357e-5,-0.00475216) * UPSCALE_0_texOff(coordinate, vec2f(2.0, 0.0));
    r += mat4x4f(0.15128,-0.119614,0.125529,0.033447,0.110727,-0.0037443,0.113909,0.0103236,0.0387699,0.0765796,0.0706597,0.0446663,-0.000294144,0.00720716,-0.00708882,0.00311115) * UPSCALE_0_texOff(coordinate, vec2f(0.0, 2.0));
    return clamp(r, vec4f(0.0), vec4f(1.0));
}

//! name: upscale layer 2
//! shape: kernel
//! hook: PRESCALE
//! domain: source
//! when: output.height / source.height > 1.2 && !hdr.source
//! input: UPSCALE_1
//! save: UPSCALE_2
//! output: HOOKED.size, rgba8unorm

fn kernel(coordinate: vec2f) -> vec4f {
    var r = vec4f(-0.11344,-0.0578227,0.050222,-0.0344889);
    r += mat4x4f(1.63428,-0.481999,-1.25775,1.37419,-1.03233,-0.101947,0.144958,-0.361048,-0.388904,0.226938,-0.47522,-0.223726,-2.24793,-0.0683298,0.160675,-0.280207) * UPSCALE_1_texOff(coordinate, vec2f(0.0, -1.0));
    r += mat4x4f(0.129162,-0.237508,0.632654,-0.633953,1.06135,-0.0322517,2.74137,0.608875,0.299907,0.724003,-1.21529,0.86721,2.78053,2.28536,-1.06286,2.19746) * UPSCALE_1_texOff(coordinate, vec2f(-1.0, 0.0));
    r += mat4x4f(0.982554,1.02824,-2.48587,-0.204571,1.8217,2.40696,-0.341413,-0.136437,0.625773,-0.078583,1.42643,0.382636,0.479496,0.511461,-1.29417,0.996286) * UPSCALE_1_texOff(coordinate, vec2f(0.0, 0.0));
    r += mat4x4f(0.453406,0.934594,-0.998145,0.341293,-1.01001,-0.0760879,-0.800326,0.981857,0.676754,-0.779959,0.727137,-0.079261,-0.743525,0.185796,-1.04356,0.136523) * UPSCALE_1_texOff(coordinate, vec2f(1.0, 0.0));
    r += mat4x4f(1.17231,0.547009,-0.969205,0.099268,2.12909,0.678211,-2.59859,1.64186,-1.53491,-0.215427,-0.162538,-1.06291,-0.0404,0.115098,-0.127142,0.514274) * UPSCALE_1_texOff(coordinate, vec2f(0.0, 1.0));
    return clamp(r, vec4f(0.0), vec4f(1.0));
}

//! name: upscale layer 3
//! shape: kernel
//! hook: PRESCALE
//! domain: source
//! when: output.height / source.height > 1.2 && !hdr.source
//! input: UPSCALE_2
//! save: UPSCALE_3
//! output: HOOKED.size, rgba8unorm

fn kernel(coordinate: vec2f) -> vec4f {
    var r = vec4f(0.497965,0.49795,0.497975,0.497675);
    r += mat4x4f(-0.138305,-0.0760797,0.00729078,-0.0116423,0.12833,0.180824,-0.0424829,-0.0125708,0.0425831,0.0214596,0.00979364,0.00926698,-0.255698,-0.374317,0.00477613,-0.0371364) * UPSCALE_2_texOff(coordinate, vec2f(0.0, -1.0));
    r += mat4x4f(0.311841,-0.0245788,0.331563,0.0175774,-0.321987,-0.0883617,-0.247872,-0.130615,0.0160545,-0.00564699,0.00457672,-0.00985049,-0.241659,0.0791438,-0.378625,0.067096) * UPSCALE_2_texOff(coordinate, vec2f(-1.0, 0.0));
    r += mat4x4f(-0.0285883,0.436357,-0.135888,0.278137,0.411318,0.0248303,0.50247,0.221817,0.249296,0.107033,0.19699,0.0578595,-0.00446464,-0.450144,-0.318598,-0.702095) * UPSCALE_2_texOff(coordinate, vec2f(0.0, 0.0));
    r += mat4x4f(0.0447918,-0.0952189,0.0816229,-0.0662204,0.0173562,0.234078,0.0172701,0.272358,0.0642769,0.229589,0.0649412,0.201253,0.0308319,0.0873547,0.0441427,0.0440728) * UPSCALE_2_texOff(coordinate, vec2f(1.0, 0.0));
    r += mat4x4f(0.0199832,-0.00260288,0.0944854,0.133053,-0.0713252,0.00435918,-0.0657189,-0.0474493,-0.00816875,-0.0267514,0.111493,0.00871234,0.00153369,-0.01156,0.0148932,-0.0506849) * UPSCALE_2_texOff(coordinate, vec2f(0.0, 1.0));
    return clamp(r, vec4f(0.0), vec4f(1.0));
}

//! name: upscale range
//! shape: kernel
//! hook: PRESCALE
//! domain: source
//! when: output.height / source.height > 1.2 && !hdr.source
//! input: HOOKED
//! save: UPSCALE_RANGE
//! output: HOOKED.size, rg16float

fn kernel(coordinate: vec2f) -> vec4f {
    var low = 1.0;
    var high = 0.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let l = dot(HOOKED_texOff(coordinate, vec2f(f32(x), f32(y))).rgb, vec3f(0.299, 0.587, 0.114));
            low = min(low, l);
            high = max(high, l);
        }
    }
    return vec4f(low, high, 0.0, 0.0);
}

//! name: upscale
//! shape: kernel
//! hook: PRESCALE
//! domain: source
//! when: output.height / source.height > 1.2 && !hdr.source
//! input: HOOKED
//! input: UPSCALE_3
//! input: UPSCALE_RANGE
//! output: HOOKED.width * 2, HOOKED.height * 2, rgba16float

fn kernel(coordinate: vec2f) -> vec4f {
    let f = fract(coordinate * UPSCALE_3_size());
    let i = vec2i(f * 2.0);
    let centre = (vec2f(0.5) - f) * UPSCALE_3_pt() + coordinate;
    var e = UPSCALE_3_tex(centre);
    let c = HOOKED_tex(coordinate) + vec4f(vec3f((e[i.y * 2 + i.x] - 0.5) * 0.305327), 0.0);
    let range = UPSCALE_RANGE_tex(centre).xy;
    let y = dot(c.rgb, vec3f(0.299, 0.587, 0.114));
    let gate = clamp((range.y - range.x - 0.1) / 0.15, 0.0, 1.0);
    let mid = (range.x + range.y) * 0.5;
    let reach = max((range.y - range.x) * 0.5, 1e-4);
    let t = clamp((y - mid) / reach, -4.0, 4.0);
    let s = mid + (reach + select(0.0, 0.0229866, t < 0.0)) * tanh(3.17725 * t) * 1.0034839;
    return vec4f(c.rgb + gate * (s - y), c.a);
}
