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


// Hybrid Database Setup (with In-Memory fallback for robustness)
const memoryArtifacts = [];
let memoryLikes = [];

// Seed an initial artifact for local memory testing
memoryArtifacts.push({
  _id: new ObjectId("60d5ec498687a412f8e12345"),
  name: "Rosetta Stone",
  image: "https://images.unsplash.com/photo-1608985160805-4f40f0653d9e",
  type: "Documents",
  historicalContext: "A granodiorite stele inscribed with three versions of a decree issued in Memphis, Egypt, in 196 BC.",
  createdAt: "196 BC",
  discoveredAt: "1799",
  discoveredBy: "Pierre-François Bouchard",
  presentLocation: "British Museum",
  adderName: "John Doe",
  adderEmail: "john@example.com",
  likeCount: 0
});

const db = {
  artifacts: {
    insertOne: async (doc) => {
      if (useMongo) {
        return await artifactsCollection.insertOne(doc);
      } else {
        const id = new ObjectId();
        const newDoc = { _id: id, ...doc };
        memoryArtifacts.push(newDoc);
        return { insertedId: id, acknowledged: true };
      }
    },
    find: async (query = {}) => {
      if (useMongo) {
        return artifactsCollection.find(query);
      } else {
        let filtered = [...memoryArtifacts];
        if (query.name && query.name.$regex) {
          const regex = new RegExp(query.name.$regex, query.name.$options || 'i');
          filtered = filtered.filter(item => regex.test(item.name));
        }
        if (query.adderEmail) {
          filtered = filtered.filter(item => item.adderEmail === query.adderEmail);
        }
        if (query._id && query._id.$in) {
          const ids = query._id.$in.map(id => id.toString());
          filtered = filtered.filter(item => ids.includes(item._id.toString()));
        }
        return {
          toArray: async () => filtered
        };
      }
    },
    findOne: async (query) => {
      if (useMongo) {
        return await artifactsCollection.findOne(query);
      } else {
        const idStr = query._id ? query._id.toString() : null;
        return memoryArtifacts.find(item => item._id.toString() === idStr) || null;
      }
    },
    updateOne: async (query, updateDoc) => {
      if (useMongo) {
        return await artifactsCollection.updateOne(query, updateDoc);
      } else {
        const idStr = query._id ? query._id.toString() : null;
        const index = memoryArtifacts.findIndex(item => item._id.toString() === idStr);
        if (index !== -1) {
          if (updateDoc.$set) {
            memoryArtifacts[index] = {
              ...memoryArtifacts[index],
              ...updateDoc.$set
            };
          }
          return { modifiedCount: 1, matchedCount: 1 };
        }
        return { modifiedCount: 0, matchedCount: 0 };
      }
    },
    deleteOne: async (query) => {
      if (useMongo) {
        return await artifactsCollection.deleteOne(query);
      } else {
        const idStr = query._id ? query._id.toString() : null;
        const index = memoryArtifacts.findIndex(item => item._id.toString() === idStr);
        if (index !== -1) {
          memoryArtifacts.splice(index, 1);
          return { deletedCount: 1 };
        }
        return { deletedCount: 0 };
      }
    }
  },
  likes: {
    findOne: async (query) => {
      if (useMongo) {
        return await likedArtifactsCollection.findOne(query);
      } else {
        return memoryLikes.find(like => 
          like.userEmail === query.userEmail && like.artifactId === query.artifactId
        ) || null;
      }
    },
    insertOne: async (doc) => {
      if (useMongo) {
        return await likedArtifactsCollection.insertOne(doc);
      } else {
        const id = new ObjectId();
        memoryLikes.push({ _id: id, ...doc });
        return { insertedId: id, acknowledged: true };
      }
    },
    deleteOne: async (query) => {
      if (useMongo) {
        return await likedArtifactsCollection.deleteOne(query);
      } else {
        const index = memoryLikes.findIndex(like => 
          like.userEmail === query.userEmail && like.artifactId === query.artifactId
        );
        if (index !== -1) {
          memoryLikes.splice(index, 1);
          return { deletedCount: 1 };
        }
        return { deletedCount: 0 };
      }
    },
    deleteMany: async (query) => {
      if (useMongo) {
        return await likedArtifactsCollection.deleteMany(query);
      } else {
        const initialLength = memoryLikes.length;
        memoryLikes = memoryLikes.filter(like => like.artifactId !== query.artifactId);
        return { deletedCount: initialLength - memoryLikes.length };
      }
    },
    find: async (query = {}) => {
      if (useMongo) {
        return likedArtifactsCollection.find(query);
      } else {
        let filtered = [...memoryLikes];
        if (query.userEmail) {
          filtered = filtered.filter(like => like.userEmail === query.userEmail);
        }
        return {
          toArray: async () => filtered
        };
      }
    }
  }
};
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
  
  const result = await db.artifacts.insertOne(artifact);
  res.status(201).send({ success: true, result });
});

app.get('/', (req, res) => {
  res.send('server is running successfully');
});

app.listen(port, () => {
  console.log(`server is running successfully on port ${port}`);
});
