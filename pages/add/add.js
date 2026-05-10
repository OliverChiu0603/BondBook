// pages/add/add.js
const app = getApp()

const EVENT_TYPES = ['婚礼', '生日', '葬礼', '满月', '乔迁', '升学', '节日', '其他', '自定义']

Page({
  data: {
    mode: 'new',
    personId: '',
    recordId: '',
    nameDisabled: false,
    eventTypes: EVENT_TYPES,
    eventTypeIndex: 0,
    eventDisabled: false,
    isCustomEvent: false,
    customEvent: '',
    submitting: false,
    form: {
      name: '',
      event: '婚礼',
      date: '',
      type: 'in',
      amount: '',
      note: ''
    }
  },

  async onLoad(options) {
    const today = this.getToday()
    if (options.personId && options.recordId) {
      wx.showLoading({ title: '加载中' })
      try {
        await app.waitForReady()
        const person = await app.getPersonById(options.personId)
        const record = person && person.records.find(r => r.id === options.recordId)
        if (person && record) {
          const idx = EVENT_TYPES.indexOf(record.event)
          this.setData({
            mode: 'edit',
            personId: options.personId,
            recordId: options.recordId,
            nameDisabled: true,
            eventTypeIndex: idx >= 0 ? idx : 0,
            form: {
              name: person.name,
              event: record.event,
              date: record.date || today,
              type: record.type,
              amount: String(record.amount),
              note: record.note || ''
            }
          })
          wx.setNavigationBarTitle({ title: '编辑事项' })
        }
      } finally {
        wx.hideLoading()
      }
    } else if (options.personId) {
      wx.showLoading({ title: '加载中' })
      try {
        await app.waitForReady()
        const person = await app.getPersonById(options.personId)
        if (person) {
          this.setData({
            mode: 'addTo',
            personId: options.personId,
            nameDisabled: true,
            'form.name': person.name,
            'form.date': today
          })
          wx.setNavigationBarTitle({ title: '添加事项' })
        }
      } finally {
        wx.hideLoading()
      }
    } else if (options.event) {
      this.setData({
        mode: 'new',
        eventDisabled: true,
        'form.date': today,
        'form.event': decodeURIComponent(options.event)
      })
    } else {
      this.setData({ mode: 'new', 'form.date': today })
    }
  },

  getToday() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  onNameInput(e) { this.setData({ 'form.name': e.detail.value }) },
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
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }) },
  onTypeTap(e) { this.setData({ 'form.type': e.currentTarget.dataset.type }) },
  onAmountInput(e) { this.setData({ 'form.amount': e.detail.value }) },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value }) },

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
    
    const { form, mode, personId, recordId } = this.data
    if (!form.name.trim()) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return }
    if (this.data.isCustomEvent && !this.data.customEvent.trim()) {
      wx.showToast({ title: '请输入自定义事件名称', icon: 'none' }); return
    }
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' }); return
    }
    const recordData = {
      event: form.event,
      date: form.date,
      type: form.type,
      amount: Number(form.amount),
      note: form.note.trim()
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中' })
    try {
      if (mode === 'edit') {
        await app.updateRecord(personId, recordId, recordData)
        wx.showToast({ title: '修改成功', icon: 'success' })
      } else if (mode === 'addTo') {
        await app.addRecordToPerson(personId, recordData)
        wx.showToast({ title: '添加成功', icon: 'success' })
      } else {
        const existing = await app.getPersonByName(form.name.trim())
        if (existing) {
          await app.addRecordToPerson(existing.id, recordData)
          wx.showToast({ title: '已合并到「' + existing.name + '」', icon: 'success' })
        } else {
          await app.addPerson(form.name.trim(), recordData)
          wx.showToast({ title: '添加成功', icon: 'success' })
        }
      }
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  }
})

