// pages/index/index.js
const app = getApp()

Page({
  data: {
    persons: [],
    filteredPersons: [],
    searchKeyword: '',
    activeFilter: 'all',
    totalOut: 0,
    totalIn: 0,
    personCount: 0,
    loading: false,
    isSharedMode: false,
    showLoginGuide: false,
    hasUserInfo: false,
    showAddMenu: false,
    showJoinBookModal: false,
    joinBookShareCode: '',
    primaryColor: '#FF6B35',
    primaryLight: '#FFF0EB',
    primaryGradient: 'linear-gradient(135deg,#FF6B35 0%,#FF9A5C 100%)'
  },

  async onLoad(options) {
    // 检查用户登录状态
    await this._checkUserLogin()
    
    // 通过好友分享链接进入，自动加入共享账本
    if (options.joinCode) {
      this._autoJoin(options.joinCode)
    } else {
      this.loadPersons()
    }
  },

  async _checkUserLogin() {
    try {
      await app.waitForReady()
      const userInfo = await app.getUserInfo()
      const hasUserInfo = !!userInfo
      
      this.setData({ hasUserInfo })
      
      // 不再自动弹出登录引导，让用户先体验功能
      // 只在用户主动使用需要登录的功能时才提示登录
    } catch (e) {
      console.error('检查登录状态失败：', e)
    }
  },

  async _autoJoin(code) {
    await app.waitForReady()
    // 如果已经在查看同一个账本，无需重复加入
    if (app.globalData.activeShareCode === code && app.isCurrentSharedMode()) {
      this.loadPersons()
      return
    }
    wx.showLoading({ title: '加入账本中...' })
    try {
      const res = await app.joinSharedBook(code)
      wx.hideLoading()
      
      if (res.success) {
        wx.showToast({ title: '已加入共享账本', icon: 'success' })
      } else if (res.needApproval) {
        wx.showModal({
          title: res.hasPending ? '等待审批' : '申请已提交',
          content: `账本"${res.bookName || '共享账本'}"需要创建者审批后才能访问。\n\n创建者可以在"设置 - 待审批加入请求"中处理您的申请。\n\n批准后，请重新扫码或输入分享码即可加入。`,
          showCancel: false
        })
      } else {
        const errorMsg = res.message || '加入失败'
        console.error('自动加入失败：', errorMsg, res)
        wx.showModal({
          title: '加入失败',
          content: errorMsg,
          showCancel: false
        })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('自动加入异常：', e)
      wx.showModal({
        title: '操作失败',
        content: `错误信息：${e.errMsg || e.message || '未知错误'}\n\n请检查网络连接或联系管理员`,
        showCancel: false
      })
    } finally {
      this.loadPersons()
    }
  },
  onShow() {
    this._loadTheme()
    this.loadPersons()
  },

  _loadTheme() {
    const theme = wx.getStorageSync('theme') || 'orange'
    const t = app.getThemeColors(theme)
    this.setData({ primaryColor: t.primary, primaryLight: t.primaryLight, primaryGradient: t.gradient })
    app._applySystemTheme(theme)
  },

  async loadPersons() {
    this.setData({ loading: true })
    try {
      await app.waitForReady()
      const isSharedMode = app.isCurrentSharedMode()
      const persons = await app.getPersons()

      let totalOut = 0, totalIn = 0
      const enriched = persons.map(p => {
        let pOut = 0, pIn = 0
        p.records.forEach(r => {
          if (r.type === 'out') pOut += Number(r.amount) || 0
          else pIn += Number(r.amount) || 0
        })
        totalOut += pOut
        totalIn += pIn
        const balance = pIn - pOut
        const eventTags = [...new Set(p.records.map(r => r.event))].slice(0, 3)
        return { ...p, totalOut: pOut, totalIn: pIn, balance, recordCount: p.records.length, eventTags }
      })

      // 按最近修改时间降序排序（最新的在前面）
      enriched.sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))

      this.setData({ persons: enriched, totalOut, totalIn, personCount: persons.length, isSharedMode })
      this.applyFilter(enriched)
    } catch (e) {
      wx.showToast({ title: '加载失败，请检查网络', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
    this.applyFilter(this.data.persons)
  },

  onFilterTap(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.filter })
    this.applyFilter(this.data.persons)
  },

  applyFilter(persons) {
    const { searchKeyword, activeFilter } = this.data
    let result = persons
    if (activeFilter === 'out') result = result.filter(p => p.totalOut > 0)
    else if (activeFilter === 'in') result = result.filter(p => p.totalIn > 0)
    if (searchKeyword.trim()) {
      result = result.filter(p => p.name.includes(searchKeyword.trim()))
    }
    this.setData({ filteredPersons: result })
  },

  onPersonTap(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  onAddTap() {
    this.setData({ showAddMenu: true })
  },

  // ---- 新用户引导 ----
  onGuideAddPerson() {
    this.setData({ showAddMenu: true })
  },

  onCloseAddMenu() {
    this.setData({ showAddMenu: false })
  },

  onAddMenuSelect(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ showAddMenu: false })
    if (type === 'single') {
      wx.navigateTo({ url: '/pages/add/add' })
    } else if (type === 'batch') {
      wx.navigateTo({ url: '/pages/batch-add/batch-add' })
    }
  },

  onGuideJoinBook() {
    this.setData({ showJoinBookModal: true, joinBookShareCode: '' })
  },

  onCloseJoinBookModal() {
    this.setData({ showJoinBookModal: false, joinBookShareCode: '' })
  },

  stopPropagation() {
    // 阻止事件冒泡，防止点击弹窗内容时关闭
  },

  onJoinBookShareCodeInput(e) {
    this.setData({ joinBookShareCode: e.detail.value })
  },

  onConfirmJoinBook() {
    const code = this.data.joinBookShareCode.trim().toUpperCase()
    if (!code) {
      wx.showToast({ title: '请输入分享码', icon: 'none' })
      return
    }
    this.setData({ showJoinBookModal: false })
    this._handleJoinBook(code)
  },

  async _handleJoinBook(code) {
    if (!code) {
      wx.showToast({ title: '请输入分享码', icon: 'none' })
      return
    }

    // 检查是否已登录
    await app.waitForReady()
    const userInfo = await app.getUserInfo()
    if (!userInfo) {
      wx.showModal({
        title: '需要登录',
        content: '加入账本需要先登录获取用户信息',
        confirmText: '去登录',
        success: async (res) => {
          if (res.confirm) {
            // 请求登录
            try {
              const profileRes = await wx.getUserProfile({
                desc: '用于显示用户信息和账本分享功能'
              })
              
              wx.showLoading({ title: '登录中' })
              
              const loginUserInfo = {
                avatarUrl: profileRes.userInfo.avatarUrl,
                nickName: profileRes.userInfo.nickName
              }
              
              await app.updateUserInfo(loginUserInfo)
              
              this.setData({ hasUserInfo: true })
              
              wx.hideLoading()
              wx.showToast({ title: '登录成功', icon: 'success' })
              
              // 登录成功后继续加入账本流程
              setTimeout(() => {
                this._handleJoinBook(code)
              }, 1000)
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

    // 检查是否是自己的账本
    const myShareCode = await app.getMyShareCode()
    if (code === myShareCode) {
      wx.showToast({ title: '不能加入自己的账本', icon: 'none' })
      return
    }

    wx.showLoading({ title: '查找账本中' })
    try {
      const result = await app.joinSharedBook(code)
      wx.hideLoading()
      
      if (result.success) {
        wx.showToast({ title: '加入成功', icon: 'success' })
        // 关闭弹窗并刷新人员列表
        this.setData({ showJoinBookModal: false })
        this.loadPersons()
      } else if (result.needApproval) {
        // 需要审批（app.js已经自动提交了申请）
        this.setData({ showJoinBookModal: false })
        wx.showModal({
          title: result.hasPending ? '等待审批' : '申请已提交',
          content: `账本"${result.bookName || '共享账本'}"需要创建者审批后才能访问。\n\n创建者可以在"设置 - 待审批加入请求"中处理您的申请。\n\n批准后，请重新输入相同的分享码即可加入账本。`,
          showCancel: false,
          confirmText: '知道了'
        })
      } else {
        // 显示具体的错误信息
        const errorMsg = result.message || '加入失败'
        console.error('加入账本失败，错误信息：', errorMsg, result)
        wx.showModal({
          title: '加入失败',
          content: errorMsg,
          showCancel: false
        })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('加入账本异常：', e)
      wx.showModal({
        title: '操作失败',
        content: `错误信息：${e.errMsg || e.message || '未知错误'}\n\n请检查网络连接或联系管理员`,
        showCancel: false
      })
    }
  },

  async _submitJoinRequest(shareCode) {
    wx.showLoading({ title: '提交申请中' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'requestJoinBook',
        data: { shareCode }
      })

      if (res.result.success) {
        wx.showToast({ title: '申请已提交，请等待审批', icon: 'success', duration: 2000 })
      } else {
        wx.showToast({ title: res.result.message || '申请失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '申请失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ---- 登录相关 ----
  async onLoginGuide() {
    try {
      const res = await wx.getUserProfile({
        desc: '用于显示用户信息和账本分享功能'
      })
      
      wx.showLoading({ title: '登录中' })
      
      // 保存用户信息到云端
      const userInfo = {
        avatarUrl: res.userInfo.avatarUrl,
        nickName: res.userInfo.nickName
      }
      
      await app.updateUserInfo(userInfo)
      
      this.setData({
        hasUserInfo: true,
        showLoginGuide: false
      })
      
      wx.hideLoading()
      wx.showToast({ title: '登录成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      console.error('登录失败：', e)
      if (e.errMsg && e.errMsg.includes('getUserProfile:fail auth deny')) {
        wx.showToast({ title: '您取消了授权', icon: 'none' })
      } else {
        wx.showToast({ title: '登录失败，请重试', icon: 'none' })
      }
    }
  },

  onCloseLoginGuide() {
    this.setData({ showLoginGuide: false })
  },

  onSkipLogin() {
    // 记录今天已经跳过登录引导
    const today = new Date().toDateString()
    wx.setStorageSync('login_guide_skip_date', today)
    
    this.setData({ showLoginGuide: false })
    wx.showToast({ 
      title: '您可以稍后在设置页面登录', 
      icon: 'none',
      duration: 2000
    })
  }
})

