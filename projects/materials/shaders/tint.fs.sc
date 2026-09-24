$input v_texcoord0, v_color0

#include "bgfx_shader.sh"

SAMPLER2D(s_texColor, 0);
uniform vec4 u_tint;

void main()
{
    vec4 source = texture2D(s_texColor, v_texcoord0) * v_color0;
    gl_FragColor = source * u_tint;
}
