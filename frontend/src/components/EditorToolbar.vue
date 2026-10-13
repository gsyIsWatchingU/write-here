<template>
  <div class="toolbar-menu">
    <EditorBlockMenu :editor="editor" @image-status="emit('image-status', $event)" />
    <div class="toolbar-group">
      <button class="icon-btn" :class="{ active: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()" title="粗体">
        <strong>B</strong>
      </button>
      <button class="icon-btn" :class="{ active: editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()" title="斜体">
        <em>I</em>
      </button>
      <button class="icon-btn" :class="{ active: editor.isActive('underline') }" @click="editor.chain().focus().toggleUnderline().run()" title="下划线">
        <u>U</u>
      </button>
      <button class="icon-btn" :class="{ active: editor.isActive('strike') }" @click="editor.chain().focus().toggleStrike().run()" title="删除线">
        <s>S</s>
      </button>
      <button class="icon-btn" :class="{ active: editor.isActive('highlight') }" @click="editor.chain().focus().toggleHighlight().run()" title="高亮">
        <span style="background:var(--primary);padding:0 4px;border:1px solid var(--border);">H</span>
      </button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <select class="heading-select" @change="setHeading($event)" :value="currentHeading">
        <option value="0">正文</option>
        <option value="1">标题 1</option>
        <option value="2">标题 2</option>
        <option value="3">标题 3</option>
        <option value="4">标题 4</option>
      </select>
      <button
        class="icon-btn markdown-format-btn"
        type="button"
        title="将全文中的 Markdown 标记（标题、表格、引用、分割线、列表、任务列表、代码块等）渲染为对应格式"
        @click="recognizeMarkdownFormats"
      >{{ markdownFormatLabel }}</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" :class="{ active: editor.isActive({ textAlign: 'left' }) }" @click="editor.chain().focus().setTextAlign('left').run()" title="居左">&#9776;</button>
      <button class="icon-btn" :class="{ active: editor.isActive({ textAlign: 'center' }) }" @click="editor.chain().focus().setTextAlign('center').run()" title="居中">&#9778;</button>
      <button class="icon-btn" :class="{ active: editor.isActive({ textAlign: 'right' }) }" @click="editor.chain().focus().setTextAlign('right').run()" title="居右">&#9782;</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" :class="{ active: editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()" title="无序列表">&#8226;</button>
      <button class="icon-btn" :class="{ active: editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()" title="有序列表">1.</button>
      <button class="icon-btn" :class="{ active: editor.isActive('taskList') }" @click="editor.chain().focus().toggleTaskList().run()" title="任务列表">&#9745;</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" :class="{ active: editor.isActive('codeBlock') }" @click="editor.chain().focus().toggleCodeBlock().run()" title="代码块">&lt;/&gt;</button>
      <button class="icon-btn" @click="editor.chain().focus().setHorizontalRule().run()" title="分割线">&#8212;</button>
      <button
        class="icon-btn collapse-toggle-btn"
        :class="{ active: editor.isActive('collapsible') }"
        @click="toggleCollapsible"
        title="一键折叠/展开：光标在折叠块内时直接切换展开状态；不在折叠块内则插入一个新折叠块"
      >折叠</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" :class="{ active: editor.isActive('subscript') }" @click="editor.chain().focus().toggleSubscript().run()" title="下标">X&#8322;</button>
      <button class="icon-btn" :class="{ active: editor.isActive('superscript') }" @click="editor.chain().focus().toggleSuperscript().run()" title="上标">X&#178;</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" @click="editor.chain().focus().undo().run()" :disabled="!editor.can().undo?.()" title="撤销">&#8617;</button>
      <button class="icon-btn" @click="editor.chain().focus().redo().run()" :disabled="!editor.can().redo?.()" title="重做">&#8618;</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <VoiceInputButton :editor="editor" />
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <AiPolishButton :editor="editor" @applied="emit('applied')" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import EditorBlockMenu from './EditorBlockMenu.vue'
import VoiceInputButton from './VoiceInputButton.vue'
import AiPolishButton from './AiPolishButton.vue'
import { convertMarkdownFormats } from '../utils/markdownFormats'
import { TextSelection } from '@tiptap/pm/state'

const props = defineProps({
  editor: { type: Object, required: true }
})

const emit = defineEmits(['applied', 'image-status'])


const markdownFormatLabel = ref('识别 MD 格式')
let labelTimer = null

const currentHeading = computed(() => {
  for (let i = 1; i <= 4; i++) {
    if (props.editor.isActive('heading', { level: i })) return String(i)
  }
  return '0'
})

function setHeading(e) {
  const level = parseInt(e.target.value)
  if (level === 0) {
    props.editor.chain().focus().setParagraph().run()
  } else {
    props.editor.chain().focus().toggleHeading({ level }).run()
  }
}

// 一键折叠/展开：光标所在块已是折叠块时翻转 open 属性（等价于点箭头），
// 否则插入一个新折叠块，并把光标放进标题行（用户可直接输入标题，
// 再点一次即切换折叠/展开）。
function toggleCollapsible() {
  const { state, view } = props.editor
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'collapsible') {
      view.dispatch(
        state.tr.setNodeMarkup($from.before(d), null, { ...node.attrs, open: !node.attrs.open })
      )
      view.focus()
      return
    }
  }

  const from = state.selection.from
  props.editor.chain().focus().insertCollapsible().run()

  // 插入成功后把光标放进新折叠块的标题行（可直接输入标题，再点一次即切换折叠）。
  // 空标题行没有独立的内容位置，但 PM 对节点起始边界按「跟随块」解析，
  // 用 TextSelection.create(doc, summary 节点位置) 即可把选区落进标题行文本块。
  // TipTap 在文本块内插入块级节点时会先拆分段落，新折叠块实际落在
  // 光标之后（不一定是 from 本身），因此匹配「第一个位置 >= from 的折叠块」。
  for (const container of view.dom.querySelectorAll('[data-collapsible]')) {
    const containerPos = view.posAtDOM(container, 0)
    if (containerPos == null || containerPos < from) continue
    const summaryEl = container.querySelector('.doc-collapsible-summary')
    if (summaryEl) {
      const summaryPos = view.posAtDOM(summaryEl, 0)
      if (summaryPos != null && summaryPos >= 0) {
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, summaryPos))
        )
      }
    }
    break
  }
  view.focus()
}

function recognizeMarkdownFormats() {
  const count = convertMarkdownFormats(props.editor)
  markdownFormatLabel.value = count > 0 ? `已渲染 ${count} 处` : '未发现 MD 格式'
  if (labelTimer) clearTimeout(labelTimer)
  labelTimer = setTimeout(() => {
    markdownFormatLabel.value = '识别 MD 格式'
    labelTimer = null
  }, 1800)
}

onBeforeUnmount(() => {
  if (labelTimer) clearTimeout(labelTimer)
})

</script>

<style scoped>
.toolbar-menu {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}
.toolbar-group {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
.toolbar-divider {
  flex-shrink: 0;
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 6px;
}
/* 正文 select 与「识别 MD 格式」/「折叠」文本按钮统一：高 34px、2px 黑描边、
   直角，文字单行不溢出（此前 select 只有 ~30px 高、1px 边框，与按钮不一致）。 */
.heading-select {
  height: 34px;
  min-height: 34px;
  padding: 4px 8px;
  border: 2px solid var(--border);
  border-radius: 0;
  font-size: 13px;
  outline: none;
  background: #fff;
  white-space: nowrap;
}
.markdown-format-btn,
.collapse-toggle-btn {
  width: auto;
  height: 34px;
  min-height: 34px;
  padding-inline: 8px;
  border: 2px solid var(--border);
  border-radius: 0;
  white-space: nowrap;
}
.markdown-format-btn {
  min-width: 92px;
}
button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
