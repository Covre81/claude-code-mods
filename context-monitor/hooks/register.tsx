import type { Register } from 'claude-code'

import { register as memoria } from './memoria'
import { register as monitor } from './monitor'
import { band as painelBand, register as painel, turnComplete as painelTurn } from './painel'
import { band as usoBand, register as uso, turnComplete as usoTurn } from './uso'

// painel, uso-vivo and memoria fused: each part is its original mod, copied, on one plugin's state.
// A plugin may hook an event only once, so the two both parts share are chained here: painel, then uso.
// ponytail: the chained next is a plain function; neither part calls next.to, add it here if one ever does.
export const register: Register = (on, options) => {
  monitor(on, options)
  memoria(on, options)
  painel(on, options)
  uso(on, options)
  on('turn.complete', ($, e, next) => painelTurn($, e, ((ev: typeof e) => usoTurn($, ev, next)) as typeof next))
  // painel's weather is drawn above uso's box, as when painel loaded first.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => painelBand($, e, ((ev: typeof e) => usoBand($, ev, next)) as typeof next))
}
