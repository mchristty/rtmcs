require('dotenv').config();
const express = require('express')
const expressJWT = require('express-jwt')
const bodyParser = require('body-parser')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const uuid = require('uuid/v4')
const AWS = require('aws-sdk')
const defaultData = require('./defaultData.json')

const awsDataFilekey = 'data/index.json'
const awsDataVersionFilekey = 'data/version.json'

const BUCKET_NAME = process.env.BUCKET_NAME ? process.env.BUCKET_NAME : 'rtmcs'

if (process.env.ACCESS_KEY) {
  const ACCESS_KEY = process.env.ACCESS_KEY
  const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY
  AWS.config.update({
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_ACCESS_KEY,
  })
} else {
  const credentials = new AWS.SharedIniFileCredentials({ profile: 'default' })
  AWS.config.credentials = credentials
}

const s3 = new AWS.S3({
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
})

const JWT_SECRET = process.env.JWT_SECRET ? process.env.JWT_SECRET : 'test_secret_12@#45jkhasdDFGD&**9sd//=['
const ADMIN_USER = process.env.ADMIN_USER ? process.env.ADMIN_USER : 'rtmcs-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ? process.env.ADMIN_PASS : 'rtmcs-@57'

let data
let version = 0
let transactionFlag = false
modifiersQueue = []

const setData = async fn => {
  if (transactionFlag) {
    modifiersQueue.push(fn)
  } else {
    transactionFlag = true
    fn(data)
    version++
    await uploadData()
    transactionFlag = false
  }
}

(async function updateFromQueue() {
  if (modifiersQueue && modifiersQueue.length > 0) {
    let modifier
    while (modifier = modifiersQueue.shift()) {
      modifier(data)
    }
    await uploadData()
  }
  setTimeout(() => {
    updateFromQueue()
  }, 500)
})()

const uploadData = async () => {
  await setAWSFile(awsDataVersionFilekey, String(version))
  await setAWSFile(awsDataFilekey, JSON.stringify(data))
}

const getData = async () => {
  try {
    const actualVersion = await getVersion()
//     const actualVersion =0
    if (actualVersion > version) {
      version = actualVersion
      data = defaultData
      // data = await getAWSjson(awsDataFilekey)
    }
    if (actualVersion === 0) {
      data = defaultData
    }
  } catch(err) {
    if (err.code === 'NoSuchKey') {
      version = 0
      data = defaultData
      uploadData()
    }
    return
  }
}

const setAWSFile = (key, value) => {
  var params = {
    Bucket: BUCKET_NAME,
    Body: value,
    Key: key,
    ACL: 'public-read',
  }
  return s3.upload(params).promise()
}

const getAWSfile = async fileKey => {
  var options = {
    Bucket: BUCKET_NAME,
    Key: fileKey,
  }
  return s3.getObject(options).promise().then(res => String(res.Body))
}

const deleteAWSFile = async key => {
  var params = {  Bucket: BUCKET_NAME, Key: key }
  return s3.deleteObject(params).promise()
}

const getAWSjson = fileKey => getAWSfile(fileKey).then(data => JSON.parse(data))

const getVersion = () => getAWSfile(awsDataVersionFilekey).then(json => Number(json))

getData()

const app = express()

app.use(cors())
app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.send('RTMCS Server')
})

app.use(expressJWT({ secret: JWT_SECRET }).unless({ path: ['/login'] }))

app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    res.status(err.status).send({ message: err.message })
    return
  }
  next()
})

app.post('/login', (req, res) => {
  const data = req.body
  if (data.username === ADMIN_USER && data.password === ADMIN_PASS) {
    const token = jwt.sign({
      data: 'admin'
    }, JWT_SECRET, { expiresIn: '1h' })
    res.send({ token })
  } else {
    res.status(401).send({ msg: 'Unauthorized' })
  }
})

app.get('/api/checkToken', (req, res) => {
  res.json({ msg: 'success' })
})

app.get('/api/refreshToken', (req, res) => {
  const token = jwt.sign({
    data: 'admin'
  }, JWT_SECRET, { expiresIn: '1h' })
  res.json({ token })
})

// People

app.get('/api/people', async (req, res) => {
  await getData()
  res.json(data.people)
})

app.post('/api/people', async (req, res) => {
  const newPerson = req.body
  const id = uuid()
  newPerson.id = id
  await setData(data => {
    data.people.push(newPerson)
  })
  res.json({ id })
})

app.post('/api/people/:id', async (req, res) => {
  const id = req.params.id
  const newPerson = req.body
  await setData(data => {
    data.people = data.people.map(
      person => person.id === id
        ? newPerson
        : person
    )
  })
  res.json({ msg: 'success' })
})

app.delete('/api/people/:id', async (req, res) => {
  const id = req.params.id
  await setData(data => {
    data.people = data.people.filter(
      person => person.id !== id
    )
  })
  res.json({ msg: 'success' })
})

// Questions

app.get('/api/question', async (req, res) => {
  await getData()
  res.json(data.questions)
})

app.post('/api/question', async (req, res) => {
  const newPerson = req.body
  const id = uuid()
  newPerson.id = id
  await setData(data => {
    data.questions.push(newPerson)
  })
  res.json({ id })
})

app.get('/api/question/:id', async (req, res) => {
  await getData()
  const id = req.params.id
  const question = data.questions.find(question => question.id === id)
  if (question) {
    res.json(question)
  } else {
    res.status(404).json({ msg: 'Not found' })
  }
})

app.post('/api/question/:id', async (req, res) => {
  const id = req.params.id
  const newPerson = req.body
  await setData(data => {
    data.questions = data.questions.map(
      person => person.id === id
        ? newPerson
        : person
    )
  })
  res.json({ msg: 'success' })
})

app.delete('/api/question/:id', async (req, res) => {
  const id = req.params.id
  await setData(data => {
    data.questions = data.questions.filter(
      person => person.id !== id
    )
  })
  try {
    await deleteAWSFile(getQuestionImgKey(id, 'default'))
  } catch (err) {}
  try {
    await deleteAWSFile(getQuestionImgKey(id, 'correct'))
  } catch (err) {}
  res.json({ msg: 'success' })
})

const getQuestionImgKey = (id, key) => `images/questions/${id}_${key}.png`

app.get('/api/question/:id/imageUploadURL/:key', async (req, res) => {
  const id = req.params.id
  const key = req.params.key
  const signedUrlExpireSeconds = 60 * 60
  const params = {
    Bucket: BUCKET_NAME,
    Key: getQuestionImgKey(id, key),
    Expires: signedUrlExpireSeconds,
    ACL: 'public-read',
    ContentType: 'image/png',
  }
  s3.getSignedUrl('putObject', params, (err, url) => {
    if (err) {
      res.status(404).json({ msg: 'Not found' })
      return
    }
    res.json({ url })
  })
})



app.get('/api/shop', async (req, res) => {
  await getData()
  res.json(data.items)
})

app.post('/api/shop', async (req, res) => {
  const newItem = req.body
  const id = uuid()
  newItem.id = id
  await setData(data => {
    data.questions.push(newItem)
  })
  res.json({ id })
})

app.get('/api/shop/:id', async (req, res) => {
  await getData()
  const id = req.params.id
  const item = data.items.find(item => item.id === id)
  if (item) {
    res.json(item)
  } else {
    res.status(404).json({ msg: 'Not found' })
  }
})

app.post('/api/shop/:id', async (req, res) => {
  const id = req.params.id
  const newItem = req.body
  await setData(data => {
    data.items = data.items.map(
      item => item.id === id
        ? newItem
        : item
    )
  })
  res.json({ msg: 'success' })
})

app.delete('/api/shop/:id', async (req, res) => {
  const id = req.params.id
  await setData(data => {
    data.items = data.items.filter(
      item => item.id !== id
    )
  })
  try {
    await deleteAWSFile(getQuestionImgKey(id))
  } catch (err) {}
  res.json({ msg: 'success' })
})

const getItemShopImgKey = (id) => `images/shop/${id}.png`

app.get('/api/shop/:id/imageUploadURL/:key', async (req, res) => {
  const id = req.params.id
  const key = req.params.key
  const signedUrlExpireSeconds = 60 * 60
  const params = {
    Bucket: BUCKET_NAME,
    Key: getItemShopImgKey(id, key),
    Expires: signedUrlExpireSeconds,
    ACL: 'public-read',
    ContentType: 'image/png',
  }
  s3.getSignedUrl('putObject', params, (err, url) => {
    if (err) {
      res.status(404).json({ msg: 'Not found' })
      return
    }
    res.json({ url })
  })
})




const listener = app.listen(process.env.NODE_ENV === 'production' ? undefined : 3004, () => {
  console.log(`Server running on port ${listener && listener.address().port}`)
})






