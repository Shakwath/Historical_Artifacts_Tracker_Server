const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER.trim()}:${process.env.DB_PASS.trim()}@cluster0.b73grgu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access: No token provided' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access: Invalid token' });
    }
    req.user = decoded;
    next();
  });
};

let useMongo = false;
let database;
let artifactsCollection;
let likedArtifactsCollection;

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    database = client.db('Historical_Artifacts');
    artifactsCollection = database.collection('Artifacts');
    likedArtifactsCollection = database.collection('LikedArtifacts');
    useMongo = true;
  } catch (error) {
    console.error("MongoDB Connection failed. Falling back to in-memory database storage.");
    console.error(error);
  }
}
run().catch(console.dir);

// JWT Authentication Routes
app.post('/jwt', async (req, res) => {
  const user = req.body;
  if (!user || !user.email) {
    return res.status(400).send({ message: 'Email is required' });
  }
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '5h' });
  
  res
    .cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    })
    .send({ success: true, token });
});

app.post('/logout', async (req, res) => {
  res
    .clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 0
    })
    .send({ success: true });
});

app.get('/', (req, res) => {
  res.send('server is running successfully');
});

app.listen(port, () => {
  console.log(`server is running successfully on port ${port}`);
});
