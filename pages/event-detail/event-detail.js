// pages/event-detail/event-detail.js
const app = getApp()

Page({
  data: {
    eventName: '',
    records: [],           // 全量数据
    filteredRecords: [],   // 搜索过滤后展示
    searchKeyword: '',
    totalIn: 0,
    totalOut: 0,
    loading: false,
    batchDate: '',
    primaryGradient: 'linear-gradient(135deg,#FF6B35 0%,#FF9A5C 100%)'
  },

  onLoad(options) {
    const eventName = decodeURIComponent(options.event || '')
    // 今天日期作为批量设置的默认值
    const today = new Date()
    const batchDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    this.setData({ eventName, batchDate })
    wx.setNavigationBarTitle({ title: eventName })
    this._loadTheme()
    this.loadRecords(eventName)
  },

  _loadTheme() {
    const theme = wx.getStorageSync('theme') || 'orange'
    const t = app.getThemeColors(theme)
    this.setData({ primaryGradient: t.gradient })
  },

  async loadRecords(eventName) {
    this.setData({ loading: true })
    try {
      await app.waitForReady()
      const persons = await app.getPersons()
      const records = []
      let totalIn = 0, totalOut = 0
      persons.forEach(p => {
        p.records.forEach(r => {
          if (r.event === eventName) {
            records.push(Object.assign({}, r, { personName: p.name, personId: p.id }))
            const amt = Number(r.amount) || 0
            if (r.type === 'in') totalIn += amt
            else totalOut += amt
          }
        })
      })
      records.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      this.setData({ records, filteredRecords: records, totalIn, totalOut, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 搜索
  onSearchInput(e) {
    const kw = e.detail.value.trim()
    const filteredRecords = kw
      ? this.data.records.filter(r => r.personName.includes(kw))
      : this.data.records
    this.setData({ searchKeyword: kw, filteredRecords })
  },

  onClearSearch() {
    this.setData({ searchKeyword: '', filteredRecords: this.data.records })
  },

  // 批量设置日期
  onBatchDateChange(e) {
    const date = e.detail.value
    wx.showModal({
      title: '批量设置日期',
      content: `确定将「${this.data.eventName}」所有 ${this.data.records.length} 条记录的日期设为 ${date}？`,
      confirmText: '确认设置',
      confirmColor: '#FF6B35',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '保存中...' })
        try {
          await app.batchSetDateForEvent(this.data.eventName, date)
          this.setData({ batchDate: date })
          wx.showToast({ title: '设置成功', icon: 'success' })
          await this.loadRecords(this.data.eventName)
        } catch (err) {
          wx.showToast({ title: '设置失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  onGoDetail(e) {
    const personId = e.currentTarget.dataset.personId
    wx.navigateTo({ url: `/pages/detail/detail?id=${personId}` })
  },

  onAddNew() {
    wx.navigateTo({ url: `/pages/add/add?event=${encodeURIComponent(this.data.eventName)}` })
  },

  onShow() {
    if (this.data.eventName) {
      this.loadRecords(this.data.eventName)
    }
  }
})

