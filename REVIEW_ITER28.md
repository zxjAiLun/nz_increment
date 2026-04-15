# Review: iter-28/offline (commit c1cbd36)

## 变更文件

| 文件 | 变更 |
|------|------|
| `src/stores/playerStore.ts` | +40 行 |
| `src/components/OfflineRewardModal.vue` | +65 行 |
| `src/App.vue` | +13 行 |

---

## 验证结果

### 1. calculateOfflineProgress

```typescript
// playerStore.ts:154-166
function calculateOfflineProgress() {
  const lastLogin = Number(localStorage.getItem(LAST_LOGIN_KEY)) || Date.now()
  const elapsed = Date.now() - lastLogin
  const maxOffline = 8 * 60 * 60 * 1000  // 8小时 cap ✓
  const cappedElapsed = Math.min(elapsed, maxOffline)
  const minutes = cappedElapsed / 60000
  const baseGold = minutes * 10  // 10金币/分钟 ✓
  const baseExp = minutes * 5    // 5经验/分钟 ✓
  return { gold: Math.floor(baseGold), exp: Math.floor(baseExp), minutes: Math.floor(minutes) }
}
```

**结果**: PASS — 逻辑正确，8小时上限，每分钟10金+5经验，Math.floor 取整。

### 2. recordLogout

```typescript
// playerStore.ts:149-152
function recordLogout() {
  localStorage.setItem(LAST_LOGIN_KEY, String(Date.now()))
  localStorage.setItem(LAST_FLOOR_KEY, String(player.value.level))
}
```

**结果**: PASS — beforeunload 时保存时间戳到 localStorage。

App.vue 注册:
```typescript
window.addEventListener('beforeunload', playerStore.recordLogout)
```

**注**: beforeunload 监听未在 onUnmounted 清理，但这是页面级事件，影响可忽略。

### 3. OfflineRewardModal

- Props: `offlineData: { gold, exp, minutes }`
- 领取逻辑: `addGold` + `addExperience` + emit close
- UI: 遮罩层 + 展示分钟数 + 金币/经验显示 + 领取按钮

**结果**: PASS — 组件结构完整，功能闭环。

### 4. App.vue onMounted

```typescript
const offline = playerStore.calculateOfflineProgress()
if (offline.minutes >= 1) {
  showOfflineModal.value = true
  offlineData.value = offline
}
<OfflineRewardModal v-if="showOfflineModal" :offline-data="offlineData" @close="showOfflineModal = false" />
```

**结果**: PASS — 登录时检查离线收益，>=1分钟则弹出。

---

## grep 验证

```
src/stores/playerStore.ts:149:  function recordLogout()
src/stores/playerStore.ts:154:  function calculateOfflineProgress()
src/stores/playerStore.ts:512:      recordLogout()
src/stores/playerStore.ts:1015:    recordLogout,
src/stores/playerStore.ts:1016:    calculateOfflineProgress,
src/App.vue:18:import OfflineRewardModal
src/App.vue:91:  const offline = playerStore.calculateOfflineProgress()
src/App.vue:96:  window.addEventListener('beforeunload', playerStore.recordLogout)
src/App.vue:124:    <OfflineRewardModal v-if="showOfflineModal" ...
```

---

## 结论

**PASS**

离线收益系统实现完整：
- 金币/经验计算正确（10+5/分钟，8小时上限）
- 登出时间戳记录（beforeunload）
- 离线弹窗 UI 和领取逻辑
- 登录时触发检查

唯一微小瑕疵：`beforeunload` 监听未在 onUnmounted 清理，不影响功能。
