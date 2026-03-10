<template>
  <div class="toolbar-menu">
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
        <span style="background:#ffeaa7;padding:0 4px;border-radius:2px;">H</span>
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
      <button class="icon-btn" @click="addImage" title="插入图片">&#128247;</button>
      <button class="icon-btn" @click="setLink" title="插入链接">&#128279;</button>
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
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  editor: { type: Object, required: true }
})

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

function insertTable() {
  props.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}

function addImage() {
  const url = prompt('请输入图片链接地址：')
  if (url) {
    props.editor.chain().focus().setImage({ src: url }).run()
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
button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
