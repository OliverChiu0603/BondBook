// pages/batch-add/batch-add.js
const app = getApp()

const EVENT_TYPES = ['婚礼', '生日', '葬礼', '满月', '乔迁', '升学', '节日', '其他', '自定义']

function makeRow() {
  return { _key: Date.now() + Math.random(), name: '', amount: '', note: '' }
}

Page({
  data: {
    eventTypes: EVENT_TYPES,
    eventTypeIndex: 0,
    isCustomEvent: false,
    customEvent: '',
    form: {
      event: '婚礼',
      date: '',
      type: 'out'
    },
    rows: [],
    submitting: false
  },

  onLoad(options) {
    const today = this._today()
    let eventIndex = 0
    let event = EVENT_TYPES[0]
    if (options.event) {
      const decoded = decodeURIComponent(options.event)
      const idx = EVENT_TYPES.indexOf(decoded)
      if (idx >= 0) { eventIndex = idx; event = decoded }
    }
    this.setData({
      eventTypeIndex: eventIndex,
      'form.event': event,
      'form.date': today,
      rows: [makeRow(), makeRow(), makeRow()]
    })
  },

  _today() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  onEventChange(e) {
    const idx = Number(e.detail.value)
    const isCustom = EVENT_TYPES[idx] === '自定义'
    this.setData({
      eventTypeIndex: idx,
      isCustomEvent: isCustom,
      'form.event': isCustom ? this.data.customEvent : EVENT_TYPES[idx]
    })
  },

  onCustomEventInput(e) {
    const val = e.detail.value
    this.setData({ customEvent: val, 'form.event': val })
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value })
  },

  onTypeTap(e) {
    this.setData({ 'form.type': e.currentTarget.dataset.type })
  },

  onNameInput(e) {
    const idx = e.currentTarget.dataset.idx
    this.setData({ [`rows[${idx}].name`]: e.detail.value })
  },

  onAmountInput(e) {
    const idx = e.currentTarget.dataset.idx
    this.setData({ [`rows[${idx}].amount`]: e.detail.value })
  },

  onNoteInput(e) {
    const idx = e.currentTarget.dataset.idx
    this.setData({ [`rows[${idx}].note`]: e.detail.value })
  },

  onAddRow() {
    const rows = [...this.data.rows, makeRow()]
    this.setData({ rows })
  },

  onDeleteRow(e) {
    const idx = e.currentTarget.dataset.idx
    if (this.data.rows.length <= 1) {
      wx.showToast({ title: '至少保留一行', icon: 'none' })
      return
    }
    const rows = this.data.rows.filter((_, i) => i !== idx)
    this.setData({ rows })
  },

  // 统计已填写的有效行
  _validRows() {
    return this.data.rows.filter(r => r.name.trim() && r.amount && !isNaN(Number(r.amount)) && Number(r.amount) > 0)
  },

  async onSubmit() {
    if (this.data.submitting) return
    
    // 检查是否已登录
    await app.waitForReady()
    const userInfo = await app.getUserInfo()
    if (!userInfo) {
      wx.showModal({
        title: '需要登录',
        content: '保存数据需要先登录获取用户信息，以便数据云端同步',
        confirmText: '去登录',
        success: async (res) => {
          if (res.confirm) {
            // 请求登录
            try {
              const profileRes = await wx.getUserProfile({
                desc: '用于显示用户信息和账本分享功能'
              })
              
              wx.showLoading({ title: '登录中' })
              
              const userInfo = {
                avatarUrl: profileRes.userInfo.avatarUrl,
                nickName: profileRes.userInfo.nickName
              }
              
              await app.updateUserInfo(userInfo)
              wx.hideLoading()
              wx.showToast({ title: '登录成功，请重新保存', icon: 'success' })
            } catch (e) {
              wx.hideLoading()
              if (e.errMsg && e.errMsg.includes('getUserProfile:fail auth deny')) {
                wx.showToast({ title: '您取消了授权', icon: 'none' })
              } else {
                wx.showToast({ title: '登录失败', icon: 'none' })
              }
            }
          }
        }
      })
      return
    }
    
    if (this.data.isCustomEvent && !this.data.customEvent.trim()) {
      wx.showToast({ title: '请输入自定义事件名称', icon: 'none' })
      return
    }
    const validRows = this._validRows()
    if (validRows.length === 0) {
      wx.showToast({ title: '请至少填写一条记录', icon: 'none' })
      return
    }
    const { form } = this.data
    wx.showModal({
      title: '批量保存',
      content: `共 ${validRows.length} 条记录，确认保存？`,
      confirmText: '确认',
      confirmColor: '#FF6B35',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ submitting: true })
        wx.showLoading({ title: '保存中...' })
        try {
          await app.waitForReady()
          const recordBase = { event: form.event, date: form.date, type: form.type }
          let saved = 0
          for (const row of validRows) {
            const record = Object.assign({}, recordBase, {
              amount: Number(row.amount),
              note: row.note.trim()
            })
            const existing = await app.getPersonByName(row.name.trim())
            if (existing) {
              await app.addRecordToPerson(existing.id, record)
            } else {
              await app.addPerson(row.name.trim(), record)
            }
            saved++
          }
          wx.hideLoading()
          wx.showToast({ title: `已保存 ${saved} 条`, icon: 'success' })
          setTimeout(() => wx.navigateBack(), 1000)
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '保存失败，请重试', icon: 'none' })
        } finally {
          this.setData({ submitting: false })
        }
      }
    })
  }
})
