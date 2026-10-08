import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { handleExternalLineBreakPaste } from '../utils/splitLineBreaks.js'

export default Extension.create({
  name: 'externalLineBreaks',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handlePaste: handleExternalLineBreakPaste } })]
  },
})
