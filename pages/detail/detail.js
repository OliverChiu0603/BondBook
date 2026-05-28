// pages/detail/detail.js
const app = getApp()

Page({
  data: {
    isLoading: true,
    person: null,
    totalIn: 0,
    totalOut: 0,
    boundPersons: [],
    bindModalVisible: false,
    allBindCandidates: [],
    bindCandidates: [],
    bindPinnedCandidates: [],
    bindOtherCandidates: [],
    bindSelectedIds: [],
    bindSearchKeyword: '',
    bindConfirmVisible: false,
    bindConfirmNames: [],
    bindConfirmNamesText: '',
    bindConfirmSelectedIds: [],
    editNameVisible: false,
    editNameValue: ''
  },

  onLoad(options) {
    this.personId = options.id
    this.loadPerson()
  },

  onShow() {
    if (this.personId) this.loadPerson()
  },

  async loadPerson() {
    this.setData({ isLoading: true })
    try {
      await app.waitForReady()
      const persons = await app.getPersons()
      const p = persons.find(item => item.id === this.personId)
      if (!p) {
        this.setData({ person: null, isLoading: false })
        return
      }

      const { totalIn, totalOut } = this._calcPersonStats(p)
      const ownLinks = new Set(p.linkedPersonIds || [])
      const boundPersons = persons
        .filter(item => item.id !== p.id)
        .filter(item => {
          const itemLinks = item.linkedPersonIds || []
          return ownLinks.has(item.id) || itemLinks.includes(p.id)
        })
        .map(item => {
          const stats = this._calcPersonStats(item)
          return {
            ...item,
            totalIn: stats.totalIn,
            totalOut: stats.totalOut,
            balance: stats.totalIn - stats.totalOut
          }
        })

      this.setData({ person: p, totalIn, totalOut, boundPersons, isLoading: false })
    } catch (e) {
      this.setData({ isLoading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  _calcPersonStats(person) {
    let totalIn = 0
    let totalOut = 0
    ;(person.records || []).forEach(r => {
      if (r.type === 'in') totalIn += Number(r.amount) || 0
      else totalOut += Number(r.amount) || 0
    })
    return { totalIn, totalOut }
  },

  _sortBindCandidates(candidates) {
    return [...(candidates || [])].sort((a, b) => {
      if (!!a.checked !== !!b.checked) return a.checked ? -1 : 1
      return (a.name || '').localeCompare(b.name || '', 'zh-CN')
    })
  },

  _filterBindCandidates(candidates, keyword) {
    const list = this._sortBindCandidates(candidates)
    const trimmedKeyword = (keyword || '').trim()
    if (!trimmedKeyword) return list
    return list.filter(item => item.name.includes(trimmedKeyword))
  },

  _splitBindCandidates(candidates) {
    const list = candidates || []
    return {
      bindPinnedCandidates: list.filter(item => item.checked),
      bindOtherCandidates: list.filter(item => !item.checked)
    }
  },

  // 添加该人的新事项
  onAddRecord() {
    wx.navigateTo({ url: `/pages/add/add?personId=${this.personId}` })
  },

  // 编辑具体某条记录
  onEditRecord(e) {
    const recordId = e.currentTarget.dataset.recordId
    wx.navigateTo({ url: `/pages/add/add?personId=${this.personId}&recordId=${recordId}` })
  },

  // 删除某条记录
  onDeleteRecord(e) {
    const recordId = e.currentTarget.dataset.recordId
    const record = this.data.person.records.find(r => r.id === recordId)
    wx.showModal({
      title: '确认删除',
      content: `确定删除「${record ? record.event : ''}」这条记录？`,
      confirmText: '删除',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中' })
          try {
            await app.deleteRecord(this.personId, recordId)
            wx.showToast({ title: '已删除', icon: 'success' })
            const p = await app.getPersonById(this.personId)
            if (!p) {
              setTimeout(() => wx.navigateBack(), 800)
            } else {
              await this.loadPerson()
            }
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  // 编辑姓名
  onEditName() {
    this.setData({ editNameVisible: true, editNameValue: this.data.person.name })
  },

  async onOpenBindModal() {
    wx.showLoading({ title: '加载成员中' })
    try {
      await app.waitForReady()
      const persons = await app.getPersons()
      const current = persons.find(item => item.id === this.personId)
      if (!current) {
        wx.showToast({ title: '记录不存在', icon: 'none' })
        return
      }

      const selectedSet = new Set(current.linkedPersonIds || [])
      const bindCandidates = persons
        .filter(item => item.id !== current.id)
        .map(item => ({
          id: item.id,
          name: item.name,
          checked: selectedSet.has(item.id)
        }))
      const sortedCandidates = this._sortBindCandidates(bindCandidates)
      const visibleSections = this._splitBindCandidates(sortedCandidates)

      this.setData({
        bindModalVisible: true,
        allBindCandidates: sortedCandidates,
        bindCandidates: sortedCandidates,
        bindPinnedCandidates: visibleSections.bindPinnedCandidates,
        bindOtherCandidates: visibleSections.bindOtherCandidates,
        bindSelectedIds: [...selectedSet],
        bindSearchKeyword: ''
      })
    } catch (e) {
      wx.showToast({ title: '读取成员失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onBindSelectionChange(e) {
    const selectedInVisibleList = e.detail.value || []
    const selectedSet = new Set(selectedInVisibleList)
    const visibleIds = new Set((this.data.bindCandidates || []).map(item => item.id))
    const allBindCandidates = (this.data.allBindCandidates || []).map(item => {
      if (!visibleIds.has(item.id)) return item
      return { ...item, checked: selectedSet.has(item.id) }
    })

    const keyword = (this.data.bindSearchKeyword || '').trim()
    const sortedCandidates = this._sortBindCandidates(allBindCandidates)
    const bindCandidates = this._filterBindCandidates(sortedCandidates, keyword)
    const visibleSections = this._splitBindCandidates(bindCandidates)
    const bindSelectedIds = sortedCandidates.filter(item => item.checked).map(item => item.id)

    this.setData({
      allBindCandidates: sortedCandidates,
      bindCandidates,
      bindPinnedCandidates: visibleSections.bindPinnedCandidates,
      bindOtherCandidates: visibleSections.bindOtherCandidates,
      bindSelectedIds
    })
  },

  onBindSearchInput(e) {
    const keyword = (e.detail.value || '').trim()
    const all = this.data.allBindCandidates || []
    const bindCandidates = this._filterBindCandidates(all, keyword)
    const visibleSections = this._splitBindCandidates(bindCandidates)
    this.setData({
      bindSearchKeyword: keyword,
      bindCandidates,
      bindPinnedCandidates: visibleSections.bindPinnedCandidates,
      bindOtherCandidates: visibleSections.bindOtherCandidates
    })
  },

  onClearBindSearch() {
    const bindCandidates = this._sortBindCandidates(this.data.allBindCandidates || [])
    const visibleSections = this._splitBindCandidates(bindCandidates)
    this.setData({
      bindSearchKeyword: '',
      bindCandidates,
      bindPinnedCandidates: visibleSections.bindPinnedCandidates,
      bindOtherCandidates: visibleSections.bindOtherCandidates
    })
  },

  _getBindConfirmNames(selectedIds) {
    const selectedSet = new Set(selectedIds || [])
    return (this.data.allBindCandidates || [])
      .filter(item => selectedSet.has(item.id))
      .map(item => item.name)
  },

  onCancelBindModal() {
    this.setData({
      bindModalVisible: false,
      allBindCandidates: [],
      bindCandidates: [],
      bindPinnedCandidates: [],
      bindOtherCandidates: [],
      bindSelectedIds: [],
      bindSearchKeyword: '',
      bindConfirmVisible: false,
      bindConfirmNames: [],
      bindConfirmNamesText: '',
      bindConfirmSelectedIds: []
    })
  },

  onSaveBindings() {
    const bindConfirmSelectedIds = [...(this.data.bindSelectedIds || [])]
    const bindConfirmNames = this._getBindConfirmNames(bindConfirmSelectedIds)
    this.setData({
      bindConfirmVisible: true,
      bindConfirmNames,
      bindConfirmNamesText: bindConfirmNames.join('、'),
      bindConfirmSelectedIds
    })
  },

  onCancelBindConfirm() {
    this.setData({
      bindConfirmVisible: false,
      bindConfirmNames: [],
      bindConfirmNamesText: '',
      bindConfirmSelectedIds: []
    })
  },

  async onConfirmSaveBindings() {
    wx.showLoading({ title: '保存中' })
    try {
      await app.setPersonBindings(this.personId, this.data.bindConfirmSelectedIds)
      this.setData({
        bindModalVisible: false,
        allBindCandidates: [],
        bindCandidates: [],
        bindPinnedCandidates: [],
        bindOtherCandidates: [],
        bindSelectedIds: [],
        bindSearchKeyword: '',
        bindConfirmVisible: false,
        bindConfirmNames: [],
        bindConfirmNamesText: '',
        bindConfirmSelectedIds: []
      })
      await this.loadPerson()
      wx.showToast({ title: '绑定已更新', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onBoundPersonTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  onNameInput(e) {
    this.setData({ editNameValue: e.detail.value })
  },

  onModalInnerTap() {},

  onCancelEdit() {
    this.setData({ editNameVisible: false, editNameValue: '' })
  },

  async onSaveName() {
    const name = this.data.editNameValue.trim()
    if (!name) {
      wx.showToast({ title: '姓名不能为空', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中' })
    try {
      await app.updatePersonName(this.personId, name)
      this.setData({ editNameVisible: false, editNameValue: '' })
      await this.loadPerson()
      wx.showToast({ title: '已保存', icon: 'success' })
    } finally {
      wx.hideLoading()
    }
  },

  // 删除整个人
  onDeletePerson() {
    wx.showModal({
      title: '删除整人',
      content: `确定删除「${this.data.person.name}」及其所有 ${(this.data.person.records || []).length} 条记录？`,
      confirmText: '全部删除',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中' })
          try {
            await app.deletePerson(this.personId)
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 800)
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  }
})

