// pages/statistics/statistics.js
const app = getApp()

Page({
  data: {
    totalOut: 0,
    totalIn: 0,
    personCount: 0,
    recordCount: 0,
    eventStats: [],
    topPersons: [],
    loading: false,
    primaryGradient: 'linear-gradient(135deg,#FF6B35 0%,#FF9A5C 100%)'
  },

  onShow() {
    this._loadTheme()
    this.loadStats()
  },

  _loadTheme() {
    const theme = wx.getStorageSync('theme') || 'orange'
    const t = app.getThemeColors(theme)
    this.setData({ primaryGradient: t.gradient })
    app._applySystemTheme(theme)
  },

  async loadStats() {
    this.setData({ loading: true })
    try {
      await app.waitForReady()
      const persons = await app.getPersons()
      let totalOut = 0, totalIn = 0, recordCount = 0
      const eventMap = {}

      const personStats = persons.map(p => {
        let pOut = 0, pIn = 0
        p.records.forEach(r => {
          const amt = Number(r.amount) || 0
          if (r.type === 'out') { pOut += amt; totalOut += amt }
          else { pIn += amt; totalIn += amt }
          recordCount++
          if (!eventMap[r.event]) eventMap[r.event] = { event: r.event, out: 0, in: 0, count: 0 }
          if (r.type === 'out') eventMap[r.event].out += amt
          else eventMap[r.event].in += amt
          eventMap[r.event].count++
        })
        return { name: p.name, totalOut: pOut, totalIn: pIn, balance: pIn - pOut, count: p.records.length }
      })

      const topPersons = personStats
        .filter(p => p.totalIn + p.totalOut > 0)
        .sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut))
        .slice(0, 10)

      const eventStats = Object.values(eventMap).sort((a, b) => (b.out + b.in) - (a.out + a.in))

      this.setData({ totalOut, totalIn, personCount: persons.length, recordCount, topPersons, eventStats })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onEventTap(e) {
    const event = e.currentTarget.dataset.event
    wx.navigateTo({ url: `/pages/event-detail/event-detail?event=${encodeURIComponent(event)}` })
  }
})

