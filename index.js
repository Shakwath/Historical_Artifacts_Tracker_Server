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

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();
    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    const database = client.db('Historical_Artifacts');
    const artifactsCollection = database.collection('Artifacts');
    const likedArtifactsCollection = database.collection('LikedArtifacts');

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