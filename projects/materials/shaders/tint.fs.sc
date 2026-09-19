$input v_texcoord0, v_color0

#include "bgfx_shader.sh"

uniform vec4 u_tint;

void main()
{
    gl_FragColor = v_color0 * u_tint;
}
