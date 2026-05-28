// app.js

const ENV_ID = 'cloud1-d3g4pqwwte9f7079d'
const MAX_USER_RECORDS = 2000
const USER_RECORD_LIMIT_MESSAGE = `添加失败：用户数据不能超过${MAX_USER_RECORDS}条，请删除部分数据后再添加`

const THEMES = {
  orange: {
    primary: '#FF6B35',
    primaryLight: '#FFF0EB',
    gradient: 'linear-gradient(135deg,#FF6B35 0%,#FF9A5C 100%)',
    shadow: 'rgba(255,107,53,0.3)',
    navBg: '#FF6B35',
    tabSelected: '#FF6B35'
  },
  blue: {
    primary: '#2196F3',
    primaryLight: '#E3F2FD',
    gradient: 'linear-gradient(135deg,#2196F3 0%,#64B5F6 100%)',
    shadow: 'rgba(33,150,243,0.3)',
    navBg: '#2196F3',
    tabSelected: '#2196F3'
  },
  green: {
    primary: '#4CAF50',
    primaryLight: '#E8F5E9',
    gradient: 'linear-gradient(135deg,#4CAF50 0%,#81C784 100%)',
    shadow: 'rgba(76,175,80,0.3)',
    navBg: '#4CAF50',
    tabSelected: '#4CAF50'
  },
  dark: {
    primary: '#455A64',
    primaryLight: '#ECEFF1',
    gradient: 'linear-gradient(135deg,#455A64 0%,#78909C 100%)',
    shadow: 'rgba(69,90,100,0.3)',
    navBg: '#37474F',
    tabSelected: '#455A64'
  }
}

App({
  globalData: {
    openid: '',
    userInfo: null, // { avatarUrl, nickName }
    activeBookId: '',
    activeShareCode: '',
    activeBookName: '',
    activeBookSource: 'own', // own | joined
    ownedBooks: [],
    joinedBooks: [],
    cloudReady: false
  },

  onLaunch() {
    wx.cloud.init({ env: ENV_ID, traceUser: true })
    this.readyPromise = this._initCloud()
    // apply saved theme on launch (nav bar + tab bar)
    const saved = wx.getStorageSync('theme') || 'orange'
    this._applySystemTheme(saved)
  },

  // ---- 主题 ----
  getThemeColors(theme) {
    return THEMES[theme] || THEMES.orange
  },

  applyTheme(theme) {
    wx.setStorageSync('theme', theme)
    this._applySystemTheme(theme)
  },

  _applySystemTheme(theme) {
    const t = THEMES[theme] || THEMES.orange
    wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: t.navBg })
    wx.setTabBarStyle({ selectedColor: t.tabSelected })
  },

  // ---- 云初始化 ----
  async _initCloud() {
    // 1. 获取 openid 和用户信息
    const loginRes = await wx.cloud.callFunction({ name: 'login' })
    this.globalData.openid = loginRes.result.openid
    const cloudUserInfo = loginRes.result.userInfo || null
    const localUserInfo = wx.getStorageSync('user_info')
    const localProfile = localUserInfo && typeof localUserInfo === 'object' ? localUserInfo : {}
    if (cloudUserInfo || localProfile.avatarUrl || localProfile.nickName) {
      this.globalData.userInfo = {
        avatarUrl: (cloudUserInfo && cloudUserInfo.avatarUrl) || localProfile.avatarUrl || '',
        nickName: (cloudUserInfo && cloudUserInfo.nickName && cloudUserInfo.nickName !== '微信用户')
          ? cloudUserInfo.nickName
          : (localProfile.nickName || (cloudUserInfo && cloudUserInfo.nickName) || '')
      }
      wx.setStorageSync('user_info', this.globalData.userInfo)
    } else {
      this.globalData.userInfo = null
    }

    // 2. 多账本初始化
    await this._ensureBooksReady()

    this.globalData.cloudReady = true
  },

  // ---- 用户信息管理 ----
  async updateUserInfo(userInfo) {
    // 调用云函数保存用户信息
    const res = await wx.cloud.callFunction({
      name: 'login',
      data: { userInfo }
    })
    this.globalData.userInfo = res.result.userInfo || userInfo
    wx.setStorageSync('user_info', this.globalData.userInfo)
    return this.globalData.userInfo
  },

  async getUserInfo() {
    await this.waitForReady()
    return this.globalData.userInfo
  },

  _genShareCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase()
  },

  _normalizeShareCode(code) {
    return String(code || '').trim().toUpperCase()
  },

  _isValidShareCode(code) {
    return /^[A-Z0-9]{6}$/.test(code)
  },

  _sanitizeBookName(name) {
    const n = String(name || '').trim()
    if (!n) return ''
    return n.slice(0, 30)
  },

  async _genUniqueShareCode() {
    const db = wx.cloud.database()
    for (let i = 0; i < 10; i++) {
      const code = this._genShareCode()
      const exists = await db.collection('books')
        .where({ shareCode: code })
        .field({ _id: true })
        .limit(1)
        .get()
      if (!exists.data.length) return code
    }
    // 理论上几乎不会触发，兜底扩展到 8 位避免冲突
    return Math.random().toString(36).substr(2, 8).toUpperCase()
  },

  _getStoredJoinedBooks() {
    const list = wx.getStorageSync('joined_books')
    if (!Array.isArray(list)) return []
    const map = new Map()
    list.forEach(item => {
      if (!item || !item.bookId) return
      const shareCode = this._normalizeShareCode(item.shareCode)
      if (!this._isValidShareCode(shareCode)) return
      map.set(item.bookId, {
        source: 'joined',
        bookId: item.bookId,
        shareCode,
        name: this._sanitizeBookName(item.name) || '共享账本',
        updateTime: Number(item.updateTime) || Date.now()
      })
    })
    return [...map.values()].sort((a, b) => b.updateTime - a.updateTime).slice(0, 100)
  },

  _saveJoinedBooks(list) {
    wx.setStorageSync('joined_books', list || [])
  },

  _getPendingJoinCodes() {
    const list = wx.getStorageSync('pending_join_codes')
    if (!Array.isArray(list)) return []
    return [...new Set(list.map(code => this._normalizeShareCode(code)).filter(code => this._isValidShareCode(code)))]
  },

  _savePendingJoinCodes(list) {
    wx.setStorageSync('pending_join_codes', list || [])
  },

  _rememberPendingJoinCode(shareCode) {
    const code = this._normalizeShareCode(shareCode)
    if (!this._isValidShareCode(code)) return
    const list = this._getPendingJoinCodes()
    if (!list.includes(code)) list.unshift(code)
    this._savePendingJoinCodes(list.slice(0, 20))
  },

  _forgetPendingJoinCode(shareCode) {
    const code = this._normalizeShareCode(shareCode)
    this._savePendingJoinCodes(this._getPendingJoinCodes().filter(item => item !== code))
  },

  async syncPendingJoinRequests() {
    await this.waitForReady()
    const codes = this._getPendingJoinCodes()
    if (!codes.length) return { joined: false }

    for (const code of codes) {
      const res = await this.joinSharedBook(code, { skipRequest: true })
      if (res.success) {
        this._forgetPendingJoinCode(code)
        return { joined: true, code, result: res }
      }
      if (!res.needApproval && !res.hasPending) {
        this._forgetPendingJoinCode(code)
      }
    }

    return { joined: false }
  },

  _removeJoinedBook(bookId) {
    const next = this._getStoredJoinedBooks().filter(item => item.bookId !== bookId)
    this._saveJoinedBooks(next)
    this.globalData.joinedBooks = next
    return next
  },

  async _switchToFirstOwnedBook() {
    const owned = await this._refreshOwnedBooks()
    const target = owned[0]
    if (!target) return false
    this._setActiveBook({
      source: 'own',
      bookId: target._id,
      shareCode: target.shareCode,
      name: target.name || '默认账本'
    })
    return true
  },

  async _validateJoinedBooks(ownedBooks) {
    const ownedIds = new Set((ownedBooks || []).map(b => b._id))
    const ownedCodes = new Set((ownedBooks || []).map(b => this._normalizeShareCode(b.shareCode)))
    const valid = []

    for (const item of this._getStoredJoinedBooks()) {
      if (ownedIds.has(item.bookId) || ownedCodes.has(item.shareCode)) continue

      try {
        const res = await wx.cloud.callFunction({
          name: 'getSharedPersons',
          data: { shareCode: item.shareCode }
        })
        if (res.result && res.result.success && !res.result.isOwner) {
          valid.push({
            ...item,
            bookId: res.result.bookId || item.bookId,
            name: res.result.bookName || item.name || '共享账本'
          })
        }
      } catch (e) {
        console.warn('验证共享账本失败：', e)
      }
    }

    this._saveJoinedBooks(valid)
    this.globalData.joinedBooks = valid
    return valid
  },

  async _ensureBooksReady() {
    const db = wx.cloud.database()
    const booksRes = await db.collection('books').where({ ownerOpenid: this.globalData.openid }).orderBy('updateTime', 'desc').get()
    let ownedBooks = booksRes.data || []

    // 全新用户：创建第一本账本
    if (ownedBooks.length === 0) {
      const localPersons = wx.getStorageSync('renqing_persons')
      const persons = (localPersons && localPersons.length > 0) ? localPersons : []
      const firstShareCode = await this._genUniqueShareCode()
      const addRes = await db.collection('books').add({
        data: {
          name: '默认账本',
          persons,
          shareCode: firstShareCode,
          createTime: Date.now(),
          updateTime: Date.now(),
          ownerOpenid: this.globalData.openid,
          approvedUsers: [],
          pendingUsers: [],
          cooperators: [],
          deletedUsers: []
        }
      })
      ownedBooks = [{
        _id: addRes._id,
        name: '默认账本',
        persons,
        shareCode: firstShareCode,
        createTime: Date.now(),
        updateTime: Date.now(),
        ownerOpenid: this.globalData.openid,
        approvedUsers: [],
        pendingUsers: [],
        cooperators: [],
        deletedUsers: []
      }]
    }

    this.globalData.ownedBooks = ownedBooks
    this.globalData.joinedBooks = await this._validateJoinedBooks(ownedBooks)

    const saved = wx.getStorageSync('active_book_ctx')
    const ownMap = new Map(ownedBooks.map(b => [b._id, b]))
    const joinedMap = new Map(this.globalData.joinedBooks.map(b => [b.bookId, b]))

    if (saved && saved.source === 'own' && ownMap.has(saved.bookId)) {
      const b = ownMap.get(saved.bookId)
      this._setActiveBook({
        source: 'own',
        bookId: b._id,
        shareCode: b.shareCode,
        name: b.name || '未命名账本'
      })
      return
    }
    if (saved && saved.source === 'joined' && joinedMap.has(saved.bookId)) {
      const b = joinedMap.get(saved.bookId)
      this._setActiveBook({
        source: 'joined',
        bookId: b.bookId,
        shareCode: b.shareCode,
        name: b.name || '共享账本'
      })
      return
    }

    const firstOwn = ownedBooks[0]
    this._setActiveBook({
      source: 'own',
      bookId: firstOwn._id,
      shareCode: firstOwn.shareCode,
      name: firstOwn.name || '默认账本'
    })
  },

  // 页面调用此方法等待云就绪
  async waitForReady() {
    await this.readyPromise
  },

  _setActiveBook({ source, bookId, shareCode, name }) {
    this.globalData.activeBookSource = source || 'own'
    this.globalData.activeBookId = bookId || ''
    this.globalData.activeShareCode = shareCode || ''
    this.globalData.activeBookName = name || '未命名账本'
    wx.setStorageSync('active_book_ctx', {
      source: this.globalData.activeBookSource,
      bookId: this.globalData.activeBookId
    })
  },

  async _refreshOwnedBooks() {
    const db = wx.cloud.database()
    const res = await db.collection('books').where({ ownerOpenid: this.globalData.openid }).orderBy('updateTime', 'desc').get()
    this.globalData.ownedBooks = res.data || []
    return this.globalData.ownedBooks
  },

  _upsertJoinedBook(book) {
    const list = this._getStoredJoinedBooks()
    const normalizedShareCode = this._normalizeShareCode(book.shareCode)
    if (!book.bookId || !this._isValidShareCode(normalizedShareCode)) return list
    const idx = list.findIndex(item => item.bookId === book.bookId)
    const next = {
      bookId: book.bookId,
      shareCode: normalizedShareCode,
      name: this._sanitizeBookName(book.name) || '共享账本',
      updateTime: Date.now()
    }
    if (idx >= 0) list[idx] = { ...list[idx], ...next }
    else list.unshift(next)
    this._saveJoinedBooks(list)
    this.globalData.joinedBooks = list
    return list
  },

  async _getOwnBookDoc() {
    await this.waitForReady()
    if (!this.globalData.activeBookId) throw new Error('当前账本不存在')
    return wx.cloud.database().collection('books').doc(this.globalData.activeBookId)
  },

  // ---- 基础存取（自动区分自己 / 共享模式）----
  async _getAll(collectionName, where, orderField, orderDirection = 'desc') {
    const db = wx.cloud.database()
    const pageSize = 100
    let skip = 0
    let all = []

    while (true) {
      let query = db.collection(collectionName).where(where || {})
      if (orderField) query = query.orderBy(orderField, orderDirection)
      const res = await query.skip(skip).limit(pageSize).get()
      const rows = res.data || []
      all = all.concat(rows)
      if (rows.length < pageSize) break
      skip += pageSize
    }

    return all
  },

  async _getSplitPersons(bookId) {
    const [personDocs, recordDocs] = await Promise.all([
      this._getAll('book_persons', { bookId }, 'updateTime', 'desc'),
      this._getAll('book_records', { bookId }, 'createTime', 'desc')
    ])
    const recordsByPerson = new Map()

    recordDocs.forEach(doc => {
      const list = recordsByPerson.get(doc.personId) || []
      list.push({
        id: doc.recordId,
        event: doc.event,
        date: doc.date,
        type: doc.type,
        amount: doc.amount,
        note: doc.note || '',
        createTime: doc.createTime,
        updateTime: doc.updateTime
      })
      recordsByPerson.set(doc.personId, list)
    })

    return personDocs.map(doc => ({
      id: doc.personId,
      name: doc.name,
      linkedPersonIds: doc.linkedPersonIds || [],
      records: recordsByPerson.get(doc.personId) || [],
      createTime: doc.createTime,
      updateTime: doc.updateTime
    }))
  },

  async _mutateBookData(action, data = {}) {
    await this.waitForReady()
    let res = await wx.cloud.callFunction({
      name: 'bookData',
      data: {
        action,
        bookId: this.globalData.activeBookId,
        shareCode: this.globalData.activeShareCode,
        ...data
      }
    })
    let hadMigration = false
    let migrationExplained = false
    while (res.result && res.result.success && res.result.needMigration) {
      hadMigration = true
      if (!migrationExplained) {
        migrationExplained = true
        const shouldContinue = await new Promise(resolve => {
          wx.showModal({
            title: '账本升级中',
            content: '这个账本历史记录较多，正在升级为更稳定的存储方式。升级期间请尽量保持小程序打开；如果现在取消，下次保存会从当前进度继续，不会丢失原数据。',
            confirmText: '继续升级',
            cancelText: '稍后再说',
            showCancel: true,
            success: modalRes => resolve(!!modalRes.confirm),
            fail: () => resolve(true)
          })
        })
        if (!shouldContinue) {
          throw new Error('账本升级已暂停，下次保存会从当前进度继续。')
        }
      }
      const migration = res.result.migration || {}
      const total = migration.totalPersons || 0
      const current = Math.min(migration.personIndex || 0, total)
      wx.showLoading({
        title: total ? `迁移中 ${current}/${total}` : '迁移中',
        mask: true
      })
      res = await wx.cloud.callFunction({
        name: 'bookData',
        data: {
          action: 'migrateStep',
          bookId: this.globalData.activeBookId,
          shareCode: this.globalData.activeShareCode
        }
      })
    }
    if (hadMigration && action !== 'migrateStep' && res.result && res.result.success) {
      res = await wx.cloud.callFunction({
        name: 'bookData',
        data: {
          action,
          bookId: this.globalData.activeBookId,
          shareCode: this.globalData.activeShareCode,
          ...data
        }
      })
    }
    if (!res.result || !res.result.success) {
      throw new Error((res.result && res.result.message) || '账本数据保存失败')
    }
    return res.result
  },

  async getPersons() {
    await this.waitForReady()
    if (this.globalData.activeBookSource === 'joined') {
      const res = await wx.cloud.callFunction({
        name: 'getSharedPersons',
        data: { shareCode: this.globalData.activeShareCode }
      })
      if (res.result && res.result.success && !res.result.isOwner) {
        return res.result.persons || []
      }
      this._removeJoinedBook(this.globalData.activeBookId)
      await this._switchToFirstOwnedBook()
      return this.getPersons()
    }
    const doc = await this._getOwnBookDoc()
    const res = await doc.get()
    const book = res.data || {}
    if (book.storageMode === 'split' || book.personsMigrated) {
      const dataRes = await this._mutateBookData('getPersons')
      return dataRes.persons || []
    }
    return book.persons || []
  },

  async savePersons(persons) {
    await this.waitForReady()
    if (Array.isArray(persons) && persons.length === 0) {
      await this._mutateBookData('clear')
      return
    }
    if (this._countRecords(persons) > MAX_USER_RECORDS) {
      throw new Error(USER_RECORD_LIMIT_MESSAGE)
    }
    if (this.globalData.activeBookSource === 'joined') {
      const res = await wx.cloud.callFunction({
        name: 'saveSharedPersons',
        data: { shareCode: this.globalData.activeShareCode, persons }
      })
      if (!res.result || !res.result.success) {
        this._removeJoinedBook(this.globalData.activeBookId)
        await this._switchToFirstOwnedBook()
        throw new Error((res.result && res.result.message) || '无权限写入共享账本')
      }
      return
    }
    const doc = await this._getOwnBookDoc()
    await doc.update({ data: { persons, updateTime: Date.now() } })
  },

  _countRecords(persons) {
    return (persons || []).reduce((total, person) => {
      return total + (Array.isArray(person.records) ? person.records.length : 0)
    }, 0)
  },

  async getRecordCount() {
    const persons = await this.getPersons()
    return this._countRecords(persons)
  },

  // ---- 查询 ----
  async getPersonById(id) {
    const persons = await this.getPersons()
    return persons.find(p => p.id === id) || null
  },

  async getPersonByName(name) {
    const persons = await this.getPersons()
    return persons.find(p => p.name === name.trim()) || null
  },

  // ---- 新增 ----
  async addPerson(name, record) {
    const now = Date.now()
    const pid = 'p' + now + Math.random().toString(36).substr(2, 4)
    const rid = 'r' + now + Math.random().toString(36).substr(2, 4)
    const newPerson = {
      id: pid,
      name: name.trim(),
      linkedPersonIds: [],
      records: [{ ...record, id: rid, createTime: now }],
      createTime: now,
      updateTime: now
    }
    await this._mutateBookData('addPerson', {
      person: {
        id: pid,
        name: name.trim(),
        linkedPersonIds: [],
        createTime: now,
        updateTime: now
      },
      record: { ...record, id: rid, createTime: now }
    })
    return newPerson
  },

  async addRecordToPerson(personId, record) {
    const now = Date.now()
    const rid = 'r' + now + Math.random().toString(36).substr(2, 4)
    const res = await this._mutateBookData('addRecord', {
      personId,
      record: { ...record, id: rid, createTime: now }
    })
    return !!res.success
  },

  // ---- 修改 ----
  async batchSetDateForEvent(eventName, date) {
    const res = await this._mutateBookData('batchSetDateForEvent', { eventName, date })
    return !!res.anyChanged
  },

  async updateRecord(personId, recordId, data) {
    const res = await this._mutateBookData('updateRecord', { personId, recordId, data })
    return !!res.success
  },

  async updatePersonName(personId, name) {
    const res = await this._mutateBookData('updatePersonName', { personId, name: name.trim() })
    return !!res.success
  },

  // ---- 绑定关系 ----
  async setPersonBindings(personId, linkedPersonIds) {
    const saveRes = await this._mutateBookData('setPersonBindings', { personId, linkedPersonIds })
    return !!saveRes.success

    const persons = await this.getPersons()
    const now = Date.now()
    const ownerIdx = persons.findIndex(p => p.id === personId)
    if (ownerIdx === -1) return false

    const validIds = new Set(persons.map(p => p.id))
    const targetIds = [...new Set((linkedPersonIds || [])
      .filter(id => id && id !== personId && validIds.has(id)))]

    const owner = persons[ownerIdx]
    const oldFamilyIds = [...new Set([personId, ...(owner.linkedPersonIds || [])])]
    const newFamilyIds = [...new Set([personId, ...targetIds])]
    const newFamilySet = new Set(newFamilyIds)
    const removedIds = oldFamilyIds.filter(id => !newFamilySet.has(id))

    owner.linkedPersonIds = targetIds
    owner.updateTime = now

    // 家庭关系内全互绑：A 绑定 B/C/D 后，B/C/D 之间也互相可见
    newFamilyIds.forEach(memberId => {
      const idx = persons.findIndex(p => p.id === memberId)
      if (idx === -1) return
      const expectedSet = new Set(newFamilyIds.filter(id => id !== memberId))
      const currentSet = new Set(persons[idx].linkedPersonIds || [])
      expectedSet.forEach(id => currentSet.add(id))
      const nextLinks = [...currentSet]
      const oldLinks = persons[idx].linkedPersonIds || []
      if (nextLinks.length !== oldLinks.length || nextLinks.some(id => !oldLinks.includes(id))) {
        persons[idx].linkedPersonIds = nextLinks
        persons[idx].updateTime = now
      }
    })

    // 解绑时要把“被移除成员”与“当前家庭成员”双向断开
    removedIds.forEach(removedId => {
      const removedIdx = persons.findIndex(p => p.id === removedId)
      if (removedIdx !== -1) {
        const oldLinks = persons[removedIdx].linkedPersonIds || []
        const filtered = oldLinks.filter(id => !newFamilySet.has(id))
        if (filtered.length !== oldLinks.length) {
          persons[removedIdx].linkedPersonIds = filtered
          persons[removedIdx].updateTime = now
        }
      }

      newFamilyIds.forEach(memberId => {
        const idx = persons.findIndex(p => p.id === memberId)
        if (idx === -1) return
        const oldLinks = persons[idx].linkedPersonIds || []
        const filtered = oldLinks.filter(id => id !== removedId)
        if (filtered.length !== oldLinks.length) {
          persons[idx].linkedPersonIds = filtered
          persons[idx].updateTime = now
        }
      })
    })

    await this.savePersons(persons)
    return true
  },

  // ---- 删除 ----
  async deleteRecord(personId, recordId) {
    const saveRes = await this._mutateBookData('deleteRecord', { personId, recordId })
    return !!saveRes.success

    const persons = await this.getPersons()
    const pIdx = persons.findIndex(p => p.id === personId)
    if (pIdx === -1) return false
    persons[pIdx].records = persons[pIdx].records.filter(r => r.id !== recordId)
    persons[pIdx].updateTime = Date.now()
    if (persons[pIdx].records.length === 0) persons.splice(pIdx, 1)
    await this.savePersons(persons)
    return true
  },

  async deletePerson(personId) {
    const saveRes = await this._mutateBookData('deletePerson', { personId })
    return !!saveRes.success

    const persons = await this.getPersons()
    const now = Date.now()
    const filtered = persons
      .filter(p => p.id !== personId)
      .map(p => {
        const links = p.linkedPersonIds || []
        if (!links.includes(personId)) return p
        return {
          ...p,
          linkedPersonIds: links.filter(id => id !== personId),
          updateTime: now
        }
      })
    await this.savePersons(filtered)
    return true
  },

  // ---- 共享功能 ----
  async getMyShareCode() {
    await this.waitForReady()
    return this.globalData.activeShareCode
  },

  async getBookSummaries() {
    await this.waitForReady()
    const db = wx.cloud.database()
    const openid = this.globalData.openid
    // 只展示未被自己删除的账本
    const owned = (await db.collection('books').where({ ownerOpenid: openid }).orderBy('updateTime', 'desc').get()).data.filter(b => !(b.deletedUsers||[]).includes(openid))
    // joinedBooks 只保留未被自己删除的
    const joined = await this._validateJoinedBooks(owned)
    if (this.globalData.activeBookSource === 'joined' && !joined.some(b => b.bookId === this.globalData.activeBookId)) {
      await this._switchToFirstOwnedBook()
    }
    this.globalData.ownedBooks = owned
    this.globalData.joinedBooks = joined

    return {
      current: {
        source: this.globalData.activeBookSource,
        bookId: this.globalData.activeBookId,
        shareCode: this.globalData.activeShareCode,
        name: this.globalData.activeBookName
      },
      owned: owned.map(b => ({
        source: 'own',
        bookId: b._id,
        shareCode: b.shareCode,
        name: b.name || '未命名账本',
        deletedUsers: b.deletedUsers || []
      })),
      joined: joined // joined 的过滤在 settings.js 里做
    }
  },

  async createBook(name) {
    await this.waitForReady()
    const bookName = this._sanitizeBookName(name) || `账本${Date.now().toString().slice(-4)}`
    const db = wx.cloud.database()
    const shareCode = await this._genUniqueShareCode()
    const addRes = await db.collection('books').add({
      data: {
        name: bookName,
        persons: [],
        shareCode,
        createTime: Date.now(),
        updateTime: Date.now(),
        ownerOpenid: this.globalData.openid,
        approvedUsers: [],
        pendingUsers: [],
        cooperators: [],
        deletedUsers: []
      }
    })
    await this._refreshOwnedBooks()
    this._setActiveBook({ source: 'own', bookId: addRes._id, shareCode, name: bookName })
    return { success: true, bookId: addRes._id, name: bookName, shareCode }
  },

  async switchBook(bookId, source) {
    await this.waitForReady()
    if (!bookId) return { success: false, message: '账本不存在' }
    if (source === 'joined') {
      const joined = this._getStoredJoinedBooks()
      const target = joined.find(item => item.bookId === bookId)
      if (!target) return { success: false, message: '共享账本不存在' }
      this._setActiveBook({
        source: 'joined',
        bookId: target.bookId,
        shareCode: target.shareCode,
        name: target.name || '共享账本'
      })
      return { success: true }
    }

    const owned = await this._refreshOwnedBooks()
    const target = owned.find(item => item._id === bookId)
    if (!target) return { success: false, message: '我的账本不存在' }
    this._setActiveBook({
      source: 'own',
      bookId: target._id,
      shareCode: target.shareCode,
      name: target.name || '未命名账本'
    })
    return { success: true }
  },

  isCurrentSharedMode() {
    return this.globalData.activeBookSource === 'joined'
  },

  // 加入他人账本（只需输入对方的分享码）
  async joinSharedBook(shareCode, options = {}) {
    const normalizedCode = this._normalizeShareCode(shareCode)
    if (!this._isValidShareCode(normalizedCode)) {
      return { success: false, message: '分享码格式错误' }
    }

    try {
      // 先尝试获取账本数据，检查权限
      const res = await wx.cloud.callFunction({
        name: 'getSharedPersons',
        data: { shareCode: normalizedCode }
      })
      
      console.log('getSharedPersons 返回结果：', res)
      
      // 已有权限，直接加入
      if (res.result && res.result.success) {
        // 如果是创建者，切换到自己的账本而不是作为共享模式
        if (res.result.isOwner) {
          const bookId = res.result.bookId
          // 刷新自己的账本列表
          await this._refreshOwnedBooks()
          // 切换到自己的账本
          const ownedBook = this.globalData.ownedBooks.find(b => b._id === bookId)
          if (ownedBook) {
            this._setActiveBook({
              source: 'own',
              bookId: ownedBook._id,
              shareCode: ownedBook.shareCode,
              name: ownedBook.name || '我的账本'
            })
            return { 
              success: true, 
              isOwner: true,
              persons: res.result.persons,
              message: '这是您自己的账本' 
            }
          }
        }
        
        // 不是创建者，作为共享账本加入
        const joinedInfo = {
          bookId: res.result.bookId,
          shareCode: normalizedCode,
          name: res.result.bookName || '共享账本'
        }
        this._upsertJoinedBook(joinedInfo)
        this._setActiveBook({
          source: 'joined',
          bookId: joinedInfo.bookId,
          shareCode: joinedInfo.shareCode,
          name: joinedInfo.name
        })
        this._forgetPendingJoinCode(normalizedCode)
        return { success: true, persons: res.result.persons }
      }
      
      // 需要审批流程
      if (res.result && res.result.needApproval) {
        this._rememberPendingJoinCode(normalizedCode)
        // 如果已经提交过申请
        if (res.result.hasPending) {
          return { 
            success: false, 
            needApproval: true,
            hasPending: true,
            bookId: res.result.bookId,
            bookName: res.result.bookName,
            message: '您的加入申请正在等待创建者审批，请耐心等待' 
          }
        }

        if (options.skipRequest) {
          return {
            success: false,
            needApproval: true,
            hasPending: false,
            bookId: res.result.bookId,
            bookName: res.result.bookName,
            message: '仍需创建者审批'
          }
        }
        
        // 发送加入请求
        console.log('开始调用 requestJoinBook，分享码：', normalizedCode)
        const requestRes = await wx.cloud.callFunction({
          name: 'requestJoinBook',
          data: { shareCode: normalizedCode }
        })
        
        console.log('requestJoinBook 返回结果：', requestRes)
        
        if (requestRes.result && requestRes.result.success) {
          this._rememberPendingJoinCode(normalizedCode)
          return { 
            success: false,
            needApproval: true,
            hasPending: true,
            bookId: res.result.bookId,
            bookName: res.result.bookName,
            message: '加入申请已发送，请等待创建者审批' 
          }
        }
        
        // 返回具体的错误信息
        const errorMsg = (requestRes.result && requestRes.result.message) || '发送申请失败'
        console.error('requestJoinBook 失败：', errorMsg, requestRes)
        return { 
          success: false, 
          message: errorMsg
        }
      }
      
      return { success: false, message: (res.result && res.result.message) || '分享码无效' }
    } catch (e) {
      console.error('joinSharedBook 异常：', e)
      return { 
        success: false, 
        message: `操作失败：${e.errMsg || e.message || '未知错误'}`
      }
    }
  },

  // 退出共享，回到自己的账本
  async exitSharedView() {
    await this.waitForReady()
    if (this.globalData.activeBookSource !== 'joined') return
    const owned = await this._refreshOwnedBooks()
    if (owned.length === 0) return
    const target = owned[0]
    this._setActiveBook({
      source: 'own',
      bookId: target._id,
      shareCode: target.shareCode,
      name: target.name || '默认账本'
    })
  }
})
