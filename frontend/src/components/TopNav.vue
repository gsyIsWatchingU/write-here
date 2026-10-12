<template>
  <header class="topbar">
    <h1 class="logo brand-logo" @click="router.push('/')">
      <img src="/lumi-icon.png" alt="" aria-hidden="true">
      <span>Lumi Doc</span>
    </h1>
    <div class="topbar-center">
      <button
        v-for="item in navItems"
        :key="item.name"
        class="nav-btn"
        :class="{ active: isActive(item) }"
        :aria-current="isActive(item) ? 'page' : undefined"
        @click="go(item)"
      >
        [{{ String(item.index).padStart(2, '0') }}] {{ item.label }}
      </button>
    </div>
    <div class="topbar-right">
      <slot name="actions"></slot>
      <!-- 涓汉璁剧疆鍏ュ彛锛氬儚绱犻鎸夐挳锛堥粦鎻忚竟鐩磋锛夛紝榻胯疆鍥炬爣 + 鐢ㄦ埛鍚嶏紝鐐瑰嚮鎵撳紑璁剧疆寮圭獥 -->
      <button
        v-if="user?.username"
        class="user-chip"
        aria-label="涓汉璁剧疆"
        title="涓汉璁剧疆"
        :aria-expanded="showSettings"
        @click.stop="openSettings"
      >
        <svg class="user-chip-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span class="user-chip-name">{{ user.username }}</span>
      </button>
    </div>

    <!-- 涓汉璁剧疆寮圭獥锛氭樀绉般€丄I 妯″瀷鎺ュ叆锛圓PI 鍦板潃 / Key / 妯″瀷锛夈€丮CP 鎺ュ叆 -->
    <div v-if="showSettings" class="modal-overlay" @click.self="closeSettings">
      <div class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <div class="settings-modal-header">
          <h3 id="settings-modal-title">涓汉璁剧疆</h3>
          <button class="ghost small" @click="closeSettings">鍏抽棴</button>
        </div>

        <div v-if="settingsLoading" class="settings-loading">鍔犺浇涓?..</div>
        <template v-else>
          <section class="settings-section">
            <h4>鐢ㄦ埛鏄电О</h4>
            <div class="settings-row">
              <input
                v-model.trim="nickname"
                maxlength="40"
                placeholder="鏄剧ず鍦ㄩ《鏍忋€佸崗浣滀笌璇勮涓殑鏄电О"
                aria-label="鐢ㄦ埛鏄电О"
                @keyup.enter="saveNickname"
              >
              <button
                class="primary"
                :disabled="savingNickname || !nickname || nickname === originalNickname"
                @click="saveNickname"
              >
                {{ savingNickname ? '淇濆瓨涓?..' : '淇濆瓨' }}
              </button>
            </div>
            <p class="settings-help">鏄电О浼氭樉绀哄湪椤舵爮銆佸崗浣滄枃妗ｄ笌璇勮涓紱鐣欑┖鏃堕粯璁ゅ彇閭 @ 鍓嶇殑閮ㄥ垎銆?/p>
          </section>

          <section class="settings-section">
            <h4>AI 妯″瀷鎺ュ叆</h4>
            <p class="settings-help">鐢ㄤ簬缂栬緫鍣ㄣ€孉I 娑﹁壊銆嶃€傚～鍐欎綘鑷繁鐨?API 鍦板潃涓庡瘑閽ュ悗锛屾鼎鑹插皢浼樺厛浣跨敤浣犵殑閰嶇疆锛涚暀绌哄垯鍥為€€鍒扮珯鐐归厤缃€?/p>
            <div class="settings-field">
              <label for="ai-base-url">API 鍦板潃</label>
              <input id="ai-base-url" v-model.trim="aiBaseUrl" placeholder="https://api.example.com/v1" maxlength="500">
            </div>
            <div class="settings-field">
              <label for="ai-api-key">API Key</label>
              <div class="settings-field-row">
                <input
                  id="ai-api-key"
                  v-model="aiApiKey"
                  type="password"
                  :placeholder="aiHasApiKey ? '宸茶缃紙鐣欑┖淇濇寔涓嶅彉锛岃緭鍏ユ柊鍊煎皢鏇挎崲锛? : 'sk-...'"
                  autocomplete="off"
                  maxlength="4096"
                >
                <button
                  v-if="aiHasApiKey"
                  class="ghost small"
                  title="绉婚櫎宸蹭繚瀛樼殑 API Key"
                  @click="removeAiApiKey"
                >绉婚櫎</button>
              </div>
            </div>
            <div class="settings-field">
              <label for="ai-model">妯″瀷</label>
              <input id="ai-model" v-model.trim="aiModel" placeholder="渚嬪 claude-sonnet-4-5" maxlength="120">
            </div>
            <div class="settings-row">
              <button class="primary" :disabled="savingAi" @click="saveAiSettings(false)">
                {{ savingAi ? '淇濆瓨涓?..' : '淇濆瓨 AI 璁剧疆' }}
              </button>
              <span v-if="aiSaveMsg" class="settings-msg">{{ aiSaveMsg }}</span>
            </div>
          </section>

          <section class="settings-section">
            <h4>MCP 鎺ュ叆</h4>
            <p class="settings-help">鐢熸垚涓汉 Token 骞堕厤缃?MCP 瀹㈡埛绔紝璁?AI 閫氳繃 MCP 璇诲彇鍜岀紪杈戜綘鐨勬枃妗ｃ€?/p>
            <McpTokensSection />
          </section>

          <section class="settings-section">
            <div class="settings-row">
              <button class="danger" @click="handleLogout">閫€鍑虹櫥褰?/button>
            </div>
          </section>
        </template>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearUser, getUser, setUser, api } from '../utils/api'
import { resolveNavItems } from '../utils/navigation'
import McpTokensSection from './McpTokensSection.vue'

const router = useRouter()
const route = useRoute()
const user = ref(getUser())

// 瀵艰埅椤逛笌缂栧彿鐢?utils/navigation.js 缁熶竴鎻愪緵锛岄〉闈笉鍐嶅悇鍐欎竴浠姐€?const navItems = computed(() => resolveNavItems(user.value))

// 鎸夎矾鐢?name 鍒ゅ畾锛岃€屼笉鏄?route.path锛氭棫鍐欐硶娣风敤浜?path 姣旇緝銆佸啓姝荤殑
// active class 鍜屽畬鍏ㄤ笉鍒ゅ畾锛孭roblems 椤甸偅涓啓姝荤殑 active 瀵艰嚧瀵艰埅姘歌繙楂樹寒
// 涓旂偣鑷繁娌℃湁鍙嶅簲銆?function isActive(item) {
  return route.name === item.name
}

function go(item) {
  if (isActive(item)) return
  router.push(item.path)
}

function handleLogout() {
  // 閫€鍑烘槸鍗遍櫓鎿嶄綔锛屽厛纭鍐嶆墽琛屻€?  if (!confirm('纭畾閫€鍑虹櫥褰曞悧锛?)) return
  // 鏈湴鐧诲嚭涓庤烦杞繀椤绘槸鍚屾鐨勶紝涓嶈兘 await /logout 缃戠粶璇锋眰 鈥斺€?  // 鍚庣鍗′綇鎴栫绾挎椂锛岀瓑寰呬細璁┿€岄€€鍑恒€嶇湅璧锋潵瀹屽叏娌″弽搴斻€?  // clearUser() 鍐呴儴宸蹭繚璇佹湰鍦板嚟鎹棤鏉′欢娓呴櫎锛屽苟鎶婅姹傚け璐ラ檷绾т负璀﹀憡銆?  clearUser()
  router.push('/login')
}

// ==================== 涓汉璁剧疆寮圭獥 ====================
const showSettings = ref(false)
const settingsLoading = ref(false)
const nickname = ref('')
const originalNickname = ref('')
const savingNickname = ref(false)
const aiBaseUrl = ref('')
const aiApiKey = ref('')
const aiHasApiKey = ref(false)
const aiModel = ref('')
const savingAi = ref(false)
const aiSaveMsg = ref('')
let aiSaveMsgTimer = null

function flashAiMsg(text) {
  aiSaveMsg.value = text
  clearTimeout(aiSaveMsgTimer)
  aiSaveMsgTimer = setTimeout(() => { aiSaveMsg.value = '' }, 3000)
}

async function openSettings() {
  showSettings.value = true
  settingsLoading.value = true
  aiSaveMsg.value = ''
  try {
    const settings = await api.getSettings()
    nickname.value = settings.nickname || ''
    originalNickname.value = settings.nickname || ''
    aiBaseUrl.value = settings.ai.baseUrl || ''
    aiApiKey.value = ''
    aiHasApiKey.value = Boolean(settings.ai.hasApiKey)
    aiModel.value = settings.ai.model || ''
  } catch (e) {
    alert(e.message || '鏃犳硶鍔犺浇涓汉璁剧疆')
    showSettings.value = false
  } finally {
    settingsLoading.value = false
  }
}

function closeSettings() {
  showSettings.value = false
}

async function saveNickname() {
  const name = nickname.value.trim()
  if (!name || savingNickname.value || name === originalNickname.value) return
  savingNickname.value = true
  try {
    const res = await api.saveSettings({ nickname: name })
    originalNickname.value = res.nickname
    // 鍚屾鏈湴鐢ㄦ埛鎬侊細椤舵爮鐢ㄦ埛鍚嶇珛鍗冲埛鏂帮紝涓斿叾瀹冮〉闈㈤噸鏂版寕杞芥椂璇诲埌鐨勪篃鏄柊鏄电О
    const current = getUser() || {}
    setUser({ ...current, username: res.nickname })
    user.value = getUser()
  } catch (e) {
    alert(e.message || '鏄电О淇濆瓨澶辫触')
  } finally {
    savingNickname.value = false
  }
}

// clearKey锛歵rue 琛ㄧず鏄惧紡绉婚櫎宸蹭繚瀛樼殑 Key锛涘惁鍒欓潪绌?apiKey 鏇挎崲锛岀┖涓蹭繚鎸佸師鏍?async function saveAiSettings(clearKey) {
  if (savingAi.value) return
  const patch = {
    ai: {
      baseUrl: aiBaseUrl.value,
      model: aiModel.value,
    },
  }
  if (clearKey) {
    patch.ai.clearApiKey = true
  } else if (aiApiKey.value.trim()) {
    patch.ai.apiKey = aiApiKey.value.trim()
  }
  savingAi.value = true
  try {
    const res = await api.saveSettings(patch)
    aiHasApiKey.value = Boolean(res.ai.hasApiKey)
    aiApiKey.value = ''
    flashAiMsg(clearKey ? '宸茬Щ闄?API Key' : 'AI 璁剧疆宸蹭繚瀛?)
  } catch (e) {
    alert(e.message || 'AI 璁剧疆淇濆瓨澶辫触')
  } finally {
    savingAi.value = false
  }
}

async function removeAiApiKey() {
  if (!confirm('纭畾绉婚櫎宸蹭繚瀛樼殑 API Key 鍚楋紵绉婚櫎鍚庛€孉I 娑﹁壊銆嶅皢鍥為€€鍒扮珯鐐归厤缃€?)) return
  await saveAiSettings(true)
}
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 24px;
  background: #fff;
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 100;
}
.logo {
  font-size: 20px;
  font-weight: 700;
  color: var(--primary);
  cursor: pointer;
  flex: none;
}
.topbar-center {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
}
.nav-btn {
  padding: 6px 12px;
  /* 瑕嗙洊鍏ㄥ眬 button 鐨?2px 榛戞弿杈?/ 36px 鏈€灏忛珮 / 700 绮椾綋锛?     鍙傝€冨鑸槸杞荤泩鐨勬枃瀛楁爣绛撅紝涓嶆槸鍍忕礌椋庢寜閽?*/
  border: none;
  min-height: 0;
  background: transparent;
  font-size: 14px;
  font-weight: 400;
  /* 鏈€変腑椤圭敤鏇存贰鐨勭伆锛屽榻愬弬鑰冨鑸偅绉嶈交鐩堟劅 */
  color: #5b665e;
  cursor: pointer;
  /* 鍙傝€冨鑸殑閫変腑鎸夐挳鏄煍鍜屽皬鍦嗚锛岃€屼笉鏄」鐩粯璁ょ殑鍍忕礌椋庣洿瑙?*/
  border-radius: 0;
  /* 鍙繃娓￠鑹茬浉鍏冲睘鎬э紝涓嶇敤 all锛岄伩鍏嶅竷灞€灞炴€ц鎰忓杩囨浮 */
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.nav-btn:hover {
  background: var(--bg-gray);
  color: var(--text-primary);
}
.nav-btn.active {
  /* 姣?--primary(#97b39b) 鏇存祬鏇存煍鐨勭伆缁垮簳锛岄厤娣辫壊鍔犵矖鏂囧瓧 */
  background: #e2ebe0;
  color: var(--text-primary);
  font-weight: 700;
}
/* 瀵艰埅 tab 鐐瑰嚮鏃朵笉瑕佷綅绉伙紝閬垮厤鍒囨崲鏃剁湅璧锋潵鍍忔姈鍔?*/
.nav-btn:active {
  transform: none;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.username {
  font-size: 14px;
  color: var(--text-secondary);
}
/* 鐢ㄦ埛鏍囩 chip锛氬儚绱犻鎸夐挳锛堥粦鎻忚竟鐩磋锛夛紝榻胯疆鍥炬爣 + 鐢ㄦ埛鍚嶏紝鐐瑰嚮鎵撳紑璁剧疆 */
.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: var(--bg);
  border: 2px solid var(--border);
  border-radius: 0;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 80ms steps(2, end), transform 80ms steps(2, end);
  white-space: nowrap;
}
.user-chip:hover {
  color: var(--text);
  background: var(--surface-hover);
}
.user-chip:active {
  transform: translate(1px, 1px);
}
.user-chip-icon {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: square;
  stroke-linejoin: miter;
  flex: none;
}
.user-chip-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 璁剧疆寮圭獥 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  padding: 32px;
  border-radius: 12px;
  width: 440px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.settings-modal {
  width: 560px;
  max-height: min(86vh, 780px);
  overflow-y: auto;
}
.settings-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.settings-modal-header h3 {
  margin: 0;
}
.settings-modal-header button {
  flex: none;
  white-space: nowrap;
}
.settings-loading {
  padding: 40px 0;
  text-align: center;
  color: var(--text-muted);
}
.settings-section {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.settings-section:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.settings-section h4 {
  margin: 0;
}
.settings-help {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.settings-row input {
  flex: 1;
  min-width: 0;
}
.settings-field {
  margin-top: 10px;
}
.settings-field label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.settings-field input {
  width: 100%;
  box-sizing: border-box;
}
.settings-field-row {
  display: flex;
  gap: 8px;
}
.settings-field-row input {
  flex: 1;
  min-width: 0;
}
.settings-field-row .ghost.small {
  flex: none;
}
.settings-msg {
  font-size: 12px;
  color: var(--primary);
}

/* 妗岄潰绔細瀵艰埅绨囩粷瀵瑰畾浣嶅浐瀹氬湪椤舵爮姝ｄ腑锛屼綅缃彧鐢卞鍣ㄥ搴﹀喅瀹氾紝
   涓嶅啀绛変簬銆宭ogo 瀹藉害涓庡彸渚у尯鍩熷搴︿箣闂寸殑涓棿鍊笺€嶁€斺€斿悇椤甸潰鍙充晶瀹藉害涓嶅悓
   锛堚€滄垜鐨勬枃妗ｂ€濇瘮鈥滅ぞ鍖?棰樺簱/鏂囨。绠＄悊鈥濆涓や釜鍔ㄤ綔鎸夐挳锛夛紝flex 甯冨眬涓?   鍒囨崲椤甸潰鏃舵暣鎺?tab 浼氭í鍚戜綅绉伙紝鐪嬭捣鏉ュ儚鏍峰紡璺冲姩銆?   .topbar 鏈韩鏄?position: sticky锛堝凡瀹氫綅鍏冪礌锛夛紝鍗冲彲浣滀负缁濆瀹氫綅
   瀛愬厓绱犵殑鍖呭惈鍧楋紝鏃犻渶涔熶笉鑳芥敼鎴?relative锛堜細澶卞幓鍚搁《锛夈€?*/
@media (min-width: 761px) {
  .topbar-center {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
}

@media (max-width: 760px) {
  .topbar {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 12px 14px;
  }
  .topbar-center {
    order: 3;
    width: 100%;
    gap: 6px;
    overflow-x: auto;
  }
  .nav-btn {
    padding: 6px 8px;
  }
  .user-chip-name {
    display: none;
  }
  .user-chip {
    padding: 5px 8px;
  }
  .settings-modal {
    width: calc(100vw - 24px);
    max-width: none;
    padding: 20px 16px;
  }
  .settings-field-row {
    flex-wrap: wrap;
  }
}
</style>
