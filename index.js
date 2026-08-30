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

// CORS setup to allow credentials for requests from frontend ports
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
  ],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER.trim()}:${process.env.DB_PASS.trim()}@cluster0.b73grgu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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

const fs = require('fs');
const path = require('path');

class MockCollection {
  constructor(name, dbFile) {
    this.name = name;
    this.dbFile = dbFile;
  }
  getData() {
    try {
      if (!fs.existsSync(this.dbFile)) {
        fs.writeFileSync(this.dbFile, JSON.stringify({ Artifacts: [], LikedArtifacts: [] }, null, 2));
      }
      const data = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
      return data[this.name] || [];
    } catch (e) {
      return [];
    }
  }
  saveData(list) {
    try {
      let data = {};
      if (fs.existsSync(this.dbFile)) {
        data = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
      }
      data[this.name] = list;
      fs.writeFileSync(this.dbFile, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Save mock data error:", e);
    }
  }
  async insertOne(doc) {
    const list = this.getData();
    const id = doc._id || new ObjectId().toString();
    const newDoc = { ...doc, _id: id };
    list.push(newDoc);
    this.saveData(list);
    return { acknowledged: true, insertedId: id };
  }
  find(query = {}) {
    const list = this.getData();
    let filtered = [...list];
    if (query.adderEmail) {
      filtered = filtered.filter(item => item.adderEmail === query.adderEmail);
    }
    if (query.userEmail) {
      filtered = filtered.filter(item => item.userEmail === query.userEmail);
    }
    if (query.artifactId) {
      filtered = filtered.filter(item => item.artifactId === query.artifactId);
    }
    if (query.name && query.name.$regex) {
      const searchRegex = new RegExp(query.name.$regex, 'i');
      filtered = filtered.filter(item => searchRegex.test(item.name));
    }
    if (query._id && query._id.$in) {
      const ids = query._id.$in.map(id => id.toString());
      filtered = filtered.filter(item => ids.includes(item._id.toString()));
    }
    return {
      toArray: async () => filtered
    };
  }
  async findOne(query = {}) {
    const list = this.getData();
    const match = list.find(item => {
      if (query._id) {
        return item._id.toString() === query._id.toString();
      }
      if (query.userEmail && query.artifactId) {
        return item.userEmail === query.userEmail && item.artifactId.toString() === query.artifactId.toString();
      }
      return false;
    });
    return match || null;
  }
  async updateOne(query, updateDoc) {
    const list = this.getData();
    const index = list.findIndex(item => item._id.toString() === query._id.toString());
    if (index === -1) return { matchedCount: 0, modifiedCount: 0 };
    const item = list[index];
    if (updateDoc.$set) {
      Object.keys(updateDoc.$set).forEach(key => {
        item[key] = updateDoc.$set[key];
      });
    }
    list[index] = item;
    this.saveData(list);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async deleteOne(query) {
    const list = this.getData();
    let index = -1;
    if (query._id) {
      index = list.findIndex(item => item._id.toString() === query._id.toString());
    } else if (query.userEmail && query.artifactId) {
      index = list.findIndex(item => item.userEmail === query.userEmail && item.artifactId.toString() === query.artifactId.toString());
    }
    if (index === -1) return { deletedCount: 0 };
    list.splice(index, 1);
    this.saveData(list);
    return { deletedCount: 1 };
  }
  async deleteMany(query) {
    let list = this.getData();
    const initialLen = list.length;
    if (query.artifactId) {
      list = list.filter(item => item.artifactId.toString() !== query.artifactId.toString());
    }
    this.saveData(list);
    return { deletedCount: initialLen - list.length };
  }
}

async function run() {
  let artifactsCollection;
  let likedArtifactsCollection;

  try {
    try {
      // Connect the client to the server (optional starting in v4.7)
      await client.connect();
      
      // Send a ping to confirm a successful connection
      await client.db("admin").command({ ping: 1 });
      console.log("Pinged your deployment. You successfully connected to MongoDB!");

      const database = client.db('Historical_Artifacts');
      artifactsCollection = database.collection('Artifacts');
      likedArtifactsCollection = database.collection('LikedArtifacts');
    } catch (dbError) {
      console.warn("Database connection failed! Setting up local db.json fallback:", dbError.message);
      const dbFile = path.resolve(__dirname, 'db.json');
      artifactsCollection = new MockCollection('Artifacts', dbFile);
      likedArtifactsCollection = new MockCollection('LikedArtifacts', dbFile);
    }

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

    // Create Artifact (Private)
    app.post('/artifacts', verifyToken, async (req, res) => {
      const artifact = req.body;
      
      if (!artifact.name || !artifact.image || !artifact.type || !artifact.historicalContext ||
          !artifact.createdAt || !artifact.discoveredAt || !artifact.discoveredBy || !artifact.presentLocation) {
        return res.status(400).send({ message: 'All fields are required' });
      }
      
      if (req.user.email !== artifact.adderEmail) {
        return res.status(403).send({ message: 'Forbidden: Email mismatch' });
      }
      
      artifact.likeCount = 0;
      
      const result = await artifactsCollection.insertOne(artifact);
      res.status(201).send({ success: true, result });
    });

    // Get All Artifacts / Search (Public)
    app.get('/artifacts', async (req, res) => {
      const { search } = req.query;
      let query = {};
      if (search) {
        query = { name: { $regex: search, $options: 'i' } };
      }
      
      const result = await artifactsCollection.find(query).toArray();
      res.send(result);
    });

    // Get My Artifacts (Private)
    app.get('/my-artifacts', verifyToken, async (req, res) => {
      const email = req.user.email;
      const query = { adderEmail: email };
      const result = await artifactsCollection.find(query).toArray();
      res.send(result);
    });

    // Get Liked Artifacts (Private)
    app.get('/liked-artifacts', verifyToken, async (req, res) => {
      const email = req.user.email;
      
      const likes = await likedArtifactsCollection.find({ userEmail: email }).toArray();
      const artifactIds = likes.map(like => {
        try {
          return new ObjectId(like.artifactId);
        } catch (err) {
          return null;
        }
      }).filter(id => id !== null);
      
      if (artifactIds.length === 0) {
        return res.send([]);
      }
      
      const query = { _id: { $in: artifactIds } };
      const result = await artifactsCollection.find(query).toArray();
      res.send(result);
    });

    // Get Single Artifact (Public/Protected check)
    app.get('/artifacts/:id', async (req, res) => {
      const id = req.params.id;
      const { email } = req.query; 
      
      let query;
      try {
        query = { _id: new ObjectId(id) };
      } catch (err) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }
      
      const artifact = await artifactsCollection.findOne(query);
      if (!artifact) {
        return res.status(404).send({ message: 'Artifact not found' });
      }
      
      let isLiked = false;
      if (email) {
        const like = await likedArtifactsCollection.findOne({
          userEmail: email,
          artifactId: id
        });
        if (like) {
          isLiked = true;
        }
      }
      
      res.send({ ...artifact, isLiked });
    });

    // Update Artifact (Private)
    app.put('/artifacts/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      
      let query;
      try {
        query = { _id: new ObjectId(id) };
      } catch (err) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }
      
      const artifact = await artifactsCollection.findOne(query);
      if (!artifact) {
        return res.status(404).send({ message: 'Artifact not found' });
      }
      
      if (artifact.adderEmail !== req.user.email) {
        return res.status(403).send({ message: 'Unauthorized: You can only update your own artifacts' });
      }
      
      const updateDoc = {
        $set: {
          name: updatedData.name,
          image: updatedData.image,
          type: updatedData.type,
          historicalContext: updatedData.historicalContext,
          createdAt: updatedData.createdAt,
          discoveredAt: updatedData.discoveredAt,
          discoveredBy: updatedData.discoveredBy,
          presentLocation: updatedData.presentLocation
        }
      };
      
      const result = await artifactsCollection.updateOne(query, updateDoc);
      res.send({ success: true, result });
    });

    // Delete Artifact (Private)
    app.delete('/artifacts/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      
      let query;
      try {
        query = { _id: new ObjectId(id) };
      } catch (err) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }
      
      const artifact = await artifactsCollection.findOne(query);
      if (!artifact) {
        return res.status(404).send({ message: 'Artifact not found' });
      }
      
      if (artifact.adderEmail !== req.user.email) {
        return res.status(403).send({ message: 'Unauthorized: You can only delete your own artifacts' });
      }
      
      const result = await artifactsCollection.deleteOne(query);
      await likedArtifactsCollection.deleteMany({ artifactId: id });
      
      res.send({ success: true, result });
    });

    // Toggle Like (Private)
    app.post('/artifacts/:id/like', verifyToken, async (req, res) => {
      const id = req.params.id;
      const email = req.user.email;
      
      let query;
      try {
        query = { _id: new ObjectId(id) };
      } catch (err) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }
      
      const artifact = await artifactsCollection.findOne(query);
      if (!artifact) {
        return res.status(404).send({ message: 'Artifact not found' });
      }
      
      const existingLike = await likedArtifactsCollection.findOne({
        userEmail: email,
        artifactId: id
      });
      
      let newCount = artifact.likeCount || 0;
      let liked = false;
      
      if (existingLike) {
        await likedArtifactsCollection.deleteOne({ userEmail: email, artifactId: id });
        newCount = Math.max(0, newCount - 1);
        await artifactsCollection.updateOne(query, { $set: { likeCount: newCount } });
        liked = false;
      } else {
        await likedArtifactsCollection.insertOne({ userEmail: email, artifactId: id });
        newCount = newCount + 1;
        await artifactsCollection.updateOne(query, { $set: { likeCount: newCount } });
        liked = true;
      }
      
      res.send({ success: true, liked, likeCount: newCount });
    });

  } finally {
    // Keep connection open
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('server is running successfully');
});

app.listen(port, () => {
  console.log(`server is running successfully on port ${port}`);
});