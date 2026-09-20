<template>
  <div class="toolbar-menu">
    <EditorBlockMenu :editor="editor" />
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
        class="icon-btn markdown-heading-btn"
        type="button"
        title="将全文中的 #～###### 转换为标题"
        @click="recognizeMarkdownHeadings"
      >{{ markdownHeadingLabel }}</button>
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
      <button class="icon-btn" :class="{ active: editor.isActive('blockquote') }" @click="editor.chain().focus().toggleBlockquote().run()" title="引用">&#10077;</button>
      <button class="icon-btn" :class="{ active: editor.isActive('codeBlock') }" @click="editor.chain().focus().toggleCodeBlock().run()" title="代码块">&lt;/&gt;</button>
      <button class="icon-btn" @click="editor.chain().focus().setHorizontalRule().run()" title="分割线">&#8212;</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" @click="insertTable" title="插入表格">&#9638;</button>
      <button class="icon-btn" @click="pickImages" :disabled="uploading" title="插入图片（可多选、支持粘贴与拖入）">▧</button>
      <button class="icon-btn" @click="setLink" title="插入链接">↗</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" :class="{ active: editor.isActive('subscript') }" @click="editor.chain().focus().toggleSubscript().run()" title="下标">X&#8322;</button>
      <button class="icon-btn" :class="{ active: editor.isActive('superscript') }" @click="editor.chain().focus().toggleSuperscript().run()" title="上标">X&#178;</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <button class="icon-btn" @click="editor.chain().focus().undo().run()" :disabled="!editor.can().chain().focus().undo().run()" title="撤销">&#8617;</button>
      <button class="icon-btn" @click="editor.chain().focus().redo().run()" :disabled="!editor.can().chain().focus().redo().run()" title="重做">&#8618;</button>
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <VoiceInputButton :editor="editor" />
    </div>

    <span class="toolbar-divider"></span>

    <div class="toolbar-group">
      <AiPolishButton :editor="editor" @applied="emit('applied')" />
    </div>

    <input
      ref="imageFileInput"
      class="image-file-input"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      @change="onImagesPicked"
    >
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import EditorBlockMenu from './EditorBlockMenu.vue'
import VoiceInputButton from './VoiceInputButton.vue'
import AiPolishButton from './AiPolishButton.vue'
import { convertMarkdownHeadings } from '../utils/markdownHeadings'
import { insertUploadedImages } from '../utils/editorImages.js'

const props = defineProps({
  editor: { type: Object, required: true }
})

const emit = defineEmits(['applied', 'image-status'])

const imageFileInput = ref(null)
const uploading = ref(false)

const markdownHeadingLabel = ref('识别 MD 标题')
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

function recognizeMarkdownHeadings() {
  const count = convertMarkdownHeadings(props.editor)
  markdownHeadingLabel.value = count > 0 ? `已转换 ${count} 个` : '未发现标题'
  if (labelTimer) clearTimeout(labelTimer)
  labelTimer = setTimeout(() => {
    markdownHeadingLabel.value = '识别 MD 标题'
    labelTimer = null
  }, 1800)
}

onBeforeUnmount(() => {
  if (labelTimer) clearTimeout(labelTimer)
})

function insertTable() {
  props.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}

function pickImages() {
  imageFileInput.value?.click()
}

async function onImagesPicked(event) {
  const files = Array.from(event.target?.files || [])
  event.target.value = ''
  if (files.length === 0) return
  uploading.value = true
  try {
    await insertUploadedImages(props.editor, files, { onStatus: (status) => emit('image-status', status) })
  } finally {
    uploading.value = false
  }
}

function setLink() {
  const previousUrl = props.editor.getAttributes('link').href
  const url = prompt('请输入链接地址：', previousUrl)
  if (url === null) return
  if (url === '') {
    props.editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  props.editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}
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
  display: flex;
  align-items: center;
  gap: 2px;
}
.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 6px;
}
.heading-select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  outline: none;
  background: #fff;
}
.markdown-heading-btn {
  width: auto;
  min-width: 92px;
  padding-inline: 8px;
  white-space: nowrap;
}
/* 文件选择框只由工具栏按钮触发，本身不占位 */
.image-file-input {
  display: none;
}
button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
