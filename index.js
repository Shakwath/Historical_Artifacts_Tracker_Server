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

app.get('/', (req, res) => {
  res.send('server is running successfully');
});

app.listen(port, () => {
  console.log(`server is running successfully on port ${port}`);
});
