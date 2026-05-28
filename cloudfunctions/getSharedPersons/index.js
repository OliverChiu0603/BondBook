// 云函数：读取他人共享账本（需要创建者批准）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function normalizeShareCode(code) {
  return String(code || '').trim().toUpperCase()
}

function isValidShareCode(code) {
  return /^[A-Z0-9]{6}$/.test(code)
}

async function ensureCollection(db, collectionName) {
  try {
    await db.collection(collectionName).limit(1).get()
  } catch (e) {
    const message = e && (e.message || e.errMsg || '')
    if (!message.includes('collection not exists') && !message.includes('DATABASE_COLLECTION_NOT_EXIST')) {
      throw e
    }

    try {
      await db.createCollection(collectionName)
    } catch (createErr) {
      const createMessage = createErr && (createErr.message || createErr.errMsg || '')
      if (!createMessage.includes('already exists') && !createMessage.includes('collection exists')) {
        throw createErr
      }
    }
  }
}

async function ensureSplitCollections(db) {
  await ensureCollection(db, 'book_persons')
  await ensureCollection(db, 'book_records')
}

async function queryAll(db, collectionName, where) {
  const pageSize = 100
  let skip = 0
  let all = []

  while (true) {
    const res = await db.collection(collectionName).where(where || {}).skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all = all.concat(rows)
    if (rows.length < pageSize) break
    skip += pageSize
  }

  return all
}

async function getBookPersons(db, book) {
  if (book.storageMode !== 'split' && !book.personsMigrated) {
    return book.persons || []
  }

  const [personDocs, recordDocs] = await Promise.all([
    queryAll(db, 'book_persons', { bookId: book._id }),
    queryAll(db, 'book_records', { bookId: book._id })
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
}

exports.main = async (event, context) => {
  const shareCode = normalizeShareCode(event.shareCode)
  if (!shareCode) return { success: false, message: '分享码不能为空' }
  if (!isValidShareCode(shareCode)) return { success: false, message: '分享码格式错误' }

  const db = cloud.database()
  await ensureSplitCollections(db)
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const booksRes = await db.collection('books')
    .where({ shareCode })
    .get()

  if (booksRes.data.length === 0) {
    return { success: false, message: '分享码不存在，请确认后重试' }
  }

  const book = booksRes.data[0]

  // 权限检查：创建者可以直接访问
  if (openid === book.ownerOpenid) {
    return {
      success: true,
      persons: await getBookPersons(db, book),
      ownerOpenid: book.ownerOpenid,
      shareCode,
      bookId: book._id,
      bookName: book.name || '共享账本',
      isOwner: true
    }
  }

  // 检查是否在已批准用户列表中
  const approvedUsers = book.approvedUsers || []
  const deletedUsers = book.deletedUsers || []
  const isApproved = approvedUsers.includes(openid) && !deletedUsers.includes(openid)
  if (!isApproved) {
    // 检查是否已经提交过申请
    const pendingUsers = book.pendingUsers || []
    const hasPending = pendingUsers.some(u => u.openid === openid)
    
    return {
      success: false,
      needApproval: true,
      hasPending,
      message: hasPending ? '您的加入申请正在等待创建者审批' : '需要创建者批准才能访问此账本',
      bookId: book._id,
      bookName: book.name || '共享账本',
      shareCode
    }
  }

  // 已批准用户，返回数据
  // 自动追踪到协作者列表
  await db.collection('books').doc(book._id).update({
    data: {
      deletedUsers: db.command.pull(openid),
      cooperators: db.command.addToSet(openid)
    }
  })

  return {
    success: true,
    persons: await getBookPersons(db, book),
    ownerOpenid: book.ownerOpenid,
    shareCode,
    bookId: book._id,
    bookName: book.name || '共享账本',
    isOwner: false
  }
}
