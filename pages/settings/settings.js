// pages/settings/settings.js
const app = getApp()

Page({
  data: {
    userInfo: null,
    hasUserInfo: false,
    myShareCode: '',
    inputShareCode: '',
    isSharedMode: false,
    currentBookName: '',
    ownedBookCount: 0,
    joinedBookCount: 0,
    books: [],
    pendingRequestCount: 0,
    shareModalVisible: false,
    cooperatorsModalVisible: false,
    cooperatorsList: [],
    currentUserRole: 'none',
    pendingUsersModalVisible: false,
    pendingUsersList: [],
    feedbackVisible: false,
    feedbackText: '',
    profileEditorVisible: false,
    profileDraft: {
      avatarUrl: '',
      nickName: ''
    },
    avatarTempPath: '',
    savingUserInfo: false,
    theme: 'orange',
    primaryColor: '#FF6B35',
    primaryLight: '#FFF0EB'
  },

  onLoad() {
    const saved = wx.getStorageSync('theme') || 'orange'
    this._applyTheme(saved)
  },

  noop() {},

  async onShow() {
    wx.showLoading({ title: '加载设置中' })
    let joinedSharedBook = false
    try {
      await app.waitForReady()
      const syncRes = await app.syncPendingJoinRequests()
      joinedSharedBook = !!syncRes.joined
      const saved = wx.getStorageSync('theme') || 'orange'
      this._applyTheme(saved)
      
      // 获取用户信息
      const userInfo = await app.getUserInfo()
      const openid = app.globalData.openid
      const savedNickName = userInfo && userInfo.nickName && userInfo.nickName !== '微信用户' ? userInfo.nickName : ''
      const profileDraft = {
        avatarUrl: userInfo && userInfo.avatarUrl ? userInfo.avatarUrl : '',
        nickName: savedNickName
      }
      this.setData({
        userInfo: userInfo ? { ...userInfo, openid } : null,
        hasUserInfo: !!userInfo,
        profileDraft
      })
      
      await this._refreshBookState()
      await this._loadPendingRequests()
    } catch (e) {
      console.error('加载设置失败：', e)
    } finally {
      wx.hideLoading()
    }
    if (joinedSharedBook) {
      wx.showToast({ title: '共享账本已加入', icon: 'success' })
    }
  },

  async _refreshBookState() {
    const summary = await app.getBookSummaries()
    const code = await app.getMyShareCode()
    const isSharedMode = app.isCurrentSharedMode()
    const joinedBooks = summary.joined
    const books = [...summary.owned, ...joinedBooks]
    this.setData({
      myShareCode: code,
      isSharedMode,
      currentBookName: summary.current.name,
      ownedBookCount: summary.owned.length,
      joinedBookCount: joinedBooks.length,
      books
    })
  },

  async onBookMore(e) {
    const { bookid, source } = e.currentTarget.dataset
    if (!bookid) return
    const isOwn = source === 'own'
    const actions = isOwn ? ['重命名', '协作者管理', '删除'] : ['删除']
    wx.showActionSheet({
      itemList: actions,
      success: async (res) => {
        if (isOwn && res.tapIndex === 0) {
          // 重命名
          wx.showModal({
            title: '重命名账本',
            editable: true,
            placeholderText: '输入新账本名',
            confirmText: '保存',
            success: async (modalRes) => {
              if (!modalRes.confirm) return
              const newName = (modalRes.content || '').trim()
              if (!newName) {
                wx.showToast({ title: '名称不能为空', icon: 'none' }); return
              }
              wx.showLoading({ title: '保存中' })
              try {
                await wx.cloud.database().collection('books').doc(bookid).update({ data: { name: newName, updateTime: Date.now() } })
                await this._refreshBookState()
                wx.showToast({ title: '已重命名', icon: 'success' })
              } catch (e) {
                wx.showToast({ title: '重命名失败', icon: 'none' })
              } finally {
                wx.hideLoading()
              }
            }
          })
        } else if (isOwn && res.tapIndex === 1) {
          // 协作者管理
          this._showCooperators(bookid)
        } else {
          // 删除
          this._deleteBookConfirm(bookid, source)
        }
      }
    })

  },

  async _showCooperators(bookId) {
    wx.showLoading({ title: '加载中' })
    try {
      const db = wx.cloud.database()
      const doc = await db.collection('books').doc(bookId).get()
      const cooperators = doc.data.cooperators || []
      const ownerOpenid = doc.data.ownerOpenid
      wx.hideLoading()
      wx.showActionSheet({
        itemList: cooperators.length ? cooperators.map((c, i) => `协作者${i+1}: ${c}`) : ['无协作者'],
        success: async (res) => {
          if (cooperators.length && res.tapIndex >= 0) {
            const cooperatorOpenid = cooperators[res.tapIndex]
            wx.showModal({
              title: '移除协作者',
              content: `确定要移除该协作者吗？\n${cooperatorOpenid}`,
              confirmText: '移除',
              confirmColor: '#f44336',
              success: async (modalRes) => {
                if (modalRes.confirm) {
                  wx.showLoading({ title: '移除中' })
                  try {
                    await wx.cloud.callFunction({
                      name: 'removeCooperator',
                      data: { bookId, cooperatorOpenid }
                    })
                    await this._refreshBookState()
                    wx.showToast({ title: '已移除', icon: 'success' })
                  } catch (e) {
                    wx.showToast({ title: '移除失败', icon: 'none' })
                  } finally {
                    wx.hideLoading()
                  }
                }
              }
            })
          }
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async _deleteBookConfirm(bookId, source) {
    wx.showLoading({ title: '校验中' })
    try {
      const db = wx.cloud.database()
      const doc = await db.collection('books').doc(bookId).get()
      const persons = doc.data.persons || []
      if (persons.length > 0) {
        wx.hideLoading()
        wx.showModal({
          title: '确认删除',
          content: `账本内还有 ${persons.length} 条数据，确定要删除吗？（不可恢复）`,
          confirmText: '删除',
          confirmColor: '#f44336',
          success: async (res) => {
            if (res.confirm) await this._deleteBook(bookId, source)
          }
        })
      } else {
        wx.hideLoading()
        wx.showModal({
          title: '确认删除',
          content: '确定要删除该账本吗？',
          confirmText: '删除',
          confirmColor: '#f44336',
          success: async (res) => {
            if (res.confirm) await this._deleteBook(bookId, source)
          }
        })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  async _deleteBook(bookId, source) {
    wx.showLoading({ title: '删除中' })
    try {
      const db = wx.cloud.database()
      const openid = app.globalData.openid
      // 标记删除
      await db.collection('books').doc(bookId).update({
        data: db.command.set({
          deletedUsers: db.command.addToSet(openid),
          updateTime: Date.now()
        })
      })
      // joined: 也移除本地 joinedBooks
      if (source === 'joined') {
        const joined = app._getStoredJoinedBooks().filter(b => b.bookId !== bookId)
        app._saveJoinedBooks(joined)
      }
      await this._refreshBookState()
      // 自动切换账本
      const summary = await app.getBookSummaries()
      const next = summary.owned[0] || summary.joined[0]
      if (next) await app.switchBook(next.bookId, next.source)
      await this._refreshBookState()
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  _applyTheme(theme) {
    const t = app.getThemeColors(theme)
    this.setData({ theme, primaryColor: t.primary, primaryLight: t.primaryLight })
    app.applyTheme(theme)
  },

  // ---- 分享功能 ----
  async onShareTap() {
    await this._refreshBookState()
    this.setData({ shareModalVisible: true, inputShareCode: '' })
  },

  onShareCodeInput(e) {
    this.setData({ inputShareCode: e.detail.value })
  },

  onCopyShareCode() {
    wx.setClipboardData({
      data: this.data.myShareCode,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  async onJoinSharedBook() {
    const code = this.data.inputShareCode.trim().toUpperCase()
    if (!code) { wx.showToast({ title: '请输入分享码', icon: 'none' }); return }
    if (code === this.data.myShareCode) {
      wx.showToast({ title: '不能加入自己的账本', icon: 'none' })
      return
    }

    // 检查是否已登录
    if (!this.data.hasUserInfo) {
      wx.showModal({
        title: '需要登录',
        content: '加入账本需要先登录获取用户信息',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            this.onLogin()
          }
        }
      })
      return
    }

    wx.showLoading({ title: '查找中' })
    try {
      const res = await app.joinSharedBook(code)
      wx.hideLoading()
      
      if (res.success) {
        await this._refreshBookState()
        this.setData({ shareModalVisible: false, isSharedMode: true })
        wx.showToast({ title: '加入成功', icon: 'success' })
      } else if (res.needApproval) {
        // 需要审批（app.js已经自动提交了申请）
        this.setData({ shareModalVisible: false })
        wx.showModal({
          title: res.hasPending ? '等待审批' : '申请已提交',
          content: `账本"${res.bookName || '共享账本'}"需要创建者审批后才能访问。\n\n创建者可以在"设置 - 待审批加入请求"中处理您的申请。\n\n批准后，您再次打开小程序或切回本页时会自动加入。`,
          showCancel: false,
          confirmText: '知道了'
        })
      } else {
        // 显示具体的错误信息
        const errorMsg = res.message || '加入失败'
        console.error('加入账本失败，错误信息：', errorMsg, res)
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
        this.setData({ shareModalVisible: false })
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

  onExitSharedView() {
    wx.showModal({
      title: '退出共享',
      content: '确定退出他人账本，回到自己的账本？',
      confirmText: '退出',
      success: async (res) => {
        if (res.confirm) {
          await app.exitSharedView()
          await this._refreshBookState()
          this.setData({ isSharedMode: false })
          wx.showToast({ title: '已退出共享', icon: 'success' })
        }
      }
    })
  },

  onCloseShareModal() {
    this.setData({ shareModalVisible: false })
  },

  async onSwitchBook() {
    try {
      const summary = await app.getBookSummaries()
      const options = [...summary.owned, ...summary.joined]
      if (!options.length) {
        wx.showToast({ title: '暂无可切换账本', icon: 'none' })
        return
      }
      const itemList = options.map(item => `${item.source === 'own' ? '我的' : '共享'} · ${item.name}`)
      wx.showActionSheet({
        itemList,
        success: async (res) => {
          const target = options[res.tapIndex]
          if (!target) return
          const switchRes = await app.switchBook(target.bookId, target.source)
          if (switchRes.success) {
            await this._refreshBookState()
            wx.showToast({ title: '已切换账本', icon: 'success' })
          } else {
            wx.showToast({ title: switchRes.message || '切换失败', icon: 'none' })
          }
        }
      })
    } catch (e) {
      wx.showToast({ title: '读取账本失败', icon: 'none' })
    }
  },

  onCreateBook() {
    wx.showModal({
      title: '新建账本',
      editable: true,
      placeholderText: '输入账本名称，如：家庭账本A',
      confirmText: '创建',
      success: async (res) => {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        wx.showLoading({ title: '创建中' })
        try {
          await app.createBook(name)
          await this._refreshBookState()
          wx.showToast({ title: '创建成功', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: '创建失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // 分享给好友（open-type="share" 按钮触发此钩子）
  onShareAppMessage(options = {}) {
    const shareType = options.target && options.target.dataset
      ? options.target.dataset.shareType
      : 'app'

    if (shareType === 'book') {
      const code = this.data.myShareCode
      return {
        title: `邀请你加入「${this.data.currentBookName || '人情账本'}」，分享码：${code}`,
        path: `/pages/index/index?joinCode=${code}`,
        imageUrl: ''
      }
    }

    return {
      title: '礼簿 BondBook',
      path: '/pages/index/index',
      imageUrl: ''
    }
  },

  // ---- 数据管理 ----
  onClearData() {
    wx.showModal({
      title: '清空所有数据',
      content: '此操作不可恢复，将删除所有人员记录，确定继续？',
      confirmText: '清空',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '清空中' })
          try {
            await app.savePersons([])
            wx.showToast({ title: '已清空', icon: 'success' })
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  // ---- 主题 ----
  onThemePick(e) {
    const theme = e.currentTarget.dataset.theme
    this._applyTheme(theme)
    wx.setStorageSync('theme', theme)
    wx.showToast({ title: '主题已切换', icon: 'success', duration: 1200 })
  },

  // ---- 关于 ----
  onFeedback() {
    this.setData({ feedbackVisible: true, feedbackText: '' })
  },

  onFeedbackInput(e) {
    this.setData({ feedbackText: e.detail.value })
  },

  onCloseFeedback() {
    this.setData({ feedbackVisible: false, feedbackText: '' })
  },

  async onSubmitFeedback() {
    const text = this.data.feedbackText.trim()
    if (!text) { wx.showToast({ title: '请输入建议内容', icon: 'none' }); return }
    wx.showLoading({ title: '提交中' })
    try {
      await wx.cloud.database().collection('feedback').add({
        data: {
          content: text,
          openid: app.globalData.openid,
          createTime: Date.now()
        }
      })
      this.setData({ feedbackVisible: false, feedbackText: '' })
      wx.showToast({ title: '感谢您的建议！', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ---- 用户信息管理 ----
  async onLogin() {
    this.onRefreshUserInfo()
  },

  async onRefreshUserInfo() {
    const current = this.data.userInfo || {}
    const nickName = current.nickName && current.nickName !== '微信用户'
      ? current.nickName
      : (this.data.profileDraft.nickName || '')
    this.setData({
      profileEditorVisible: true,
      avatarTempPath: '',
      profileDraft: {
        avatarUrl: current.avatarUrl || this.data.profileDraft.avatarUrl || '',
        nickName
      }
    })
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl
    if (!avatarUrl) return
    this.setData({
      avatarTempPath: avatarUrl,
      'profileDraft.avatarUrl': avatarUrl
    })
  },

  onNicknameInput(e) {
    this.setData({
      'profileDraft.nickName': e.detail.value
    })
  },

  async onSaveUserProfile() {
    if (this.data.savingUserInfo) return

    const openid = app.globalData.openid || ''
    const nickName = String(this.data.profileDraft.nickName || '').trim() || `用户${openid.slice(-4) || '0000'}`

    this.setData({ savingUserInfo: true })
    wx.showLoading({ title: '保存中' })

    try {
      let avatarUrl = this.data.profileDraft.avatarUrl || ''
      if (this.data.avatarTempPath) {
        const extMatch = this.data.avatarTempPath.match(/\.(jpg|jpeg|png|webp)$/i)
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${openid}_${Date.now()}.${ext}`,
          filePath: this.data.avatarTempPath
        })
        avatarUrl = uploadRes.fileID
      }

      const userInfo = { avatarUrl, nickName }
      const savedUserInfo = await app.updateUserInfo(userInfo)

      this.setData({
        userInfo: { ...savedUserInfo, openid },
        hasUserInfo: true,
        profileDraft: {
          avatarUrl: savedUserInfo.avatarUrl || '',
          nickName: savedUserInfo.nickName || ''
        },
        avatarTempPath: '',
        profileEditorVisible: false
      })

      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      console.error('保存用户信息失败：', e)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ savingUserInfo: false })
    }
  },

  onCancelProfileEdit() {
    const current = this.data.userInfo || {}
    this.setData({
      profileEditorVisible: false,
      avatarTempPath: '',
      profileDraft: {
        avatarUrl: current.avatarUrl || '',
        nickName: current.nickName || ''
      }
    })
  },

  async onLogout() {
    wx.showModal({
      title: '确认注销',
      content: '注销后将清除您的登录信息，但不会删除账本数据。确定要注销吗？',
      confirmText: '注销',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '注销中' })
          try {
            // 清除应用全局数据中的用户信息
            app.globalData.userInfo = null
            wx.removeStorageSync('user_info')
            
            // 更新当前页面状态
            this.setData({
              userInfo: null,
              hasUserInfo: false
            })
            
            wx.hideLoading()
            wx.showToast({ 
              title: '已注销', 
              icon: 'success',
              duration: 2000
            })
          } catch (e) {
            wx.hideLoading()
            console.error('注销失败：', e)
            wx.showToast({ title: '注销失败，请重试', icon: 'none' })
          }
        }
      }
    })
  },

  // ---- 查看共享成员 ----
  async onViewCooperators() {
    wx.showLoading({ title: '加载中' })
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'getCooperators',
        data: { bookId: app.globalData.activeBookId }
      })
      
      wx.hideLoading()
      
      console.log('getCooperators 返回结果：', res)
      
      if (!res.result || !res.result.success) {
        const message = res.result?.message || '加载失败'
        wx.showToast({ title: message, icon: 'none', duration: 2500 })
        console.error('获取协作者失败：', res.result)
        return
      }
      
      const { owner, cooperators, currentUserRole, totalCount } = res.result
      const list = []
      
      // 添加创建者
      if (owner) {
        list.push(owner)
      }
      
      // 添加协作者
      if (cooperators && cooperators.length > 0) {
        list.push(...cooperators)
      }
      
      console.log('成员列表：', { owner, cooperators, list, totalCount })
      
      if (list.length === 0) {
        wx.showModal({
          title: '暂无成员信息',
          content: '可能是云函数未部署或用户信息未同步。创建者需要先登录一次才会显示信息。',
          showCancel: false
        })
        return
      }
      
      this.setData({
        cooperatorsList: list,
        currentUserRole,
        cooperatorsModalVisible: true
      })
    } catch (e) {
      wx.hideLoading()
      console.error('调用getCooperators失败：', e)
      const errorMsg = e.errMsg || e.message || '网络错误'
      wx.showModal({
        title: '加载失败',
        content: `错误信息：${errorMsg}\n\n请确认 getCooperators 云函数已部署。`,
        showCancel: false
      })
    }
  },

  onCloseCooperatorsModal() {
    this.setData({ cooperatorsModalVisible: false })
  },

  async onRemoveCooperator(e) {
    const { openid, nickname } = e.currentTarget.dataset
    
    wx.showModal({
      title: '移除协作者',
      content: `确定要移除协作者"${nickname}"吗？`,
      confirmText: '移除',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '移除中' })
          try {
            await wx.cloud.callFunction({
              name: 'removeCooperator',
              data: { 
                bookId: app.globalData.activeBookId,
                cooperatorOpenid: openid
              }
            })
            
            wx.showToast({ title: '已移除', icon: 'success' })
            
            // 刷新列表
            this.setData({ cooperatorsModalVisible: false })
            await this._refreshBookState()
          } catch (e) {
            console.error('移除协作者失败：', e)
            wx.showToast({ title: '移除失败', icon: 'none' })
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  // ---- 待审批请求管理 ----
  async _loadPendingRequests() {
    // 只有在查看自己的账本时才加载待审批请求
    if (this.data.isSharedMode) {
      this.setData({ pendingRequestCount: 0 })
      return
    }
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'getPendingRequests',
        data: { bookId: app.globalData.activeBookId }
      })
      
      if (res.result && res.result.success) {
        this.setData({ pendingRequestCount: res.result.count || 0 })
      } else {
        this.setData({ pendingRequestCount: 0 })
        console.error('加载待审批请求失败：', res.result)
      }
    } catch (e) {
      console.error('调用getPendingRequests失败：', e)
      this.setData({ pendingRequestCount: 0 })
    }
  },

  async onViewPendingRequests() {
    if (this.data.isSharedMode) {
      wx.showToast({ title: '当前不是您的账本', icon: 'none' })
      return
    }

    wx.showLoading({ title: '加载中' })
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'getPendingRequests',
        data: { bookId: app.globalData.activeBookId }
      })
      
      wx.hideLoading()
      
      if (!res.result || !res.result.success) {
        const message = res.result?.message || '加载失败'
        wx.showToast({ title: message, icon: 'none', duration: 2000 })
        console.error('获取待审批请求失败：', res.result)
        return
      }
      
      const pendingUsers = res.result.pendingUsers || []
      
      if (pendingUsers.length === 0) {
        wx.showToast({ title: '暂无待审批请求', icon: 'none' })
        return
      }
      
      this.setData({
        pendingUsersList: pendingUsers,
        pendingUsersModalVisible: true
      })
    } catch (e) {
      wx.hideLoading()
      console.error('调用getPendingRequests失败：', e)
      wx.showToast({ title: '网络错误，请检查网络连接', icon: 'none', duration: 2000 })
    }
  },

  onClosePendingUsersModal() {
    this.setData({ pendingUsersModalVisible: false })
  },

  onApprovePendingUser(e) {
    const { openid, nickname } = e.currentTarget.dataset
    this._handlePendingRequest(openid, nickname, 'approve')
  },

  onRejectPendingUser(e) {
    const { openid, nickname } = e.currentTarget.dataset
    this._handlePendingRequest(openid, nickname, 'reject')
  },

  _handlePendingRequest(openid, nickname, action) {
    const actionText = action === 'approve' ? '批准' : '拒绝'
    wx.showModal({
      title: `${actionText}加入请求`,
      content: `确定要${actionText}用户"${nickname || '微信用户'}"的加入请求吗？`,
      confirmText: actionText,
      confirmColor: action === 'approve' ? this.data.primaryColor : '#f44336',
      success: async (res) => {
        if (res.confirm) {
          await this._handleRequest(openid, action)
          this.setData({ pendingUsersModalVisible: false })
        }
      }
    })
  },

  _showRequestActions(user) {
    wx.showModal({
      title: '审批加入请求',
      content: `用户：${user.nickName}\n是否允许该用户访问您的账本？`,
      confirmText: '批准',
      cancelText: '拒绝',
      success: async (res) => {
        const action = res.confirm ? 'approve' : 'reject'
        await this._handleRequest(user.openid, action)
      }
    })
  },

  async _handleRequest(requestOpenid, action) {
    wx.showLoading({ title: action === 'approve' ? '批准中' : '拒绝中' })
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageJoinRequest',
        data: {
          bookId: app.globalData.activeBookId,
          requestOpenid,
          action
        }
      })
      
      if (res.result.success) {
        await this._loadPendingRequests()
        wx.showToast({
          title: action === 'approve' ? '已批准' : '已拒绝',
          icon: 'success'
        })
      } else {
        wx.showToast({ title: res.result.message || '操作失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
