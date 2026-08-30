const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// =========================
// Middleware
// =========================

app.use(
  cors({
    origin: [
      "https://historical-artifacts-tracker-client-two.vercel.app",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176",
    ],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// =========================
// MongoDB Configuration
// =========================

const dbUser = process.env.DB_USER?.trim();
const dbPass = process.env.DB_PASS?.trim();

if (!dbUser || !dbPass) {
  console.error("DB_USER or DB_PASS is missing in .env");
  process.exit(1);
}

const uri = `mongodb+srv://${encodeURIComponent(
  dbUser
)}:${encodeURIComponent(
  dbPass
)}@cluster0.b73grgu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Database collections
let artifactsCollection;
let likedArtifactsCollection;

// =========================
// JWT Middleware
// =========================

const verifyToken = (req, res, next) => {
  try {
    const token =
      req.cookies?.token ||
      req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please login first.",
      });
    }

    jwt.verify(token, process.env.JWT_SECRET, (error, decoded) => {
      if (error) {
        return res.status(403).json({
          success: false,
          message: "Invalid or expired token.",
        });
      }

      req.user = decoded;
      next();
    });
  } catch (error) {
    console.error("JWT Error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication error.",
    });
  }
};

// =========================
// Root Route
// =========================

app.get("/", (req, res) => {
  res.send("Historical Artifacts Tracker Server is running successfully");
});

// =========================
// JWT Login
// =========================

app.post("/jwt", async (req, res) => {
  try {
    const user = req.body;

    if (!user?.email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const token = jwt.sign(user, process.env.JWT_SECRET, {
      expiresIn: "5h",
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 5 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
    });
  } catch (error) {
    console.error("JWT creation error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create token",
    });
  }
});

// =========================
// Logout
// =========================

app.post("/logout", async (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });

  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// =========================
// CREATE ARTIFACT
// =========================

app.post("/artifacts", verifyToken, async (req, res) => {
  try {
    const artifact = req.body;

    const requiredFields = [
      "name",
      "image",
      "type",
      "historicalContext",
      "createdAt",
      "discoveredAt",
      "discoveredBy",
      "presentLocation",
      "adderName",
      "adderEmail",
    ];

    const missingFields = requiredFields.filter(
      (field) =>
        artifact[field] === undefined ||
        artifact[field] === null ||
        String(artifact[field]).trim() === ""
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields.",
        missingFields,
      });
    }

    // Make sure logged-in user's email matches artifact owner
    if (req.user.email !== artifact.adderEmail) {
      return res.status(403).json({
        success: false,
        message: "User email does not match logged-in account.",
      });
    }

    const newArtifact = {
      name: artifact.name.trim(),
      image: artifact.image.trim(),
      type: artifact.type,
      historicalContext: artifact.historicalContext.trim(),
      createdAt: artifact.createdAt,
      discoveredAt: artifact.discoveredAt,
      discoveredBy: artifact.discoveredBy.trim(),
      presentLocation: artifact.presentLocation.trim(),
      adderName: artifact.adderName.trim(),
      adderEmail: artifact.adderEmail.trim(),
      likeCount: 0,
      createdAtTimestamp: new Date(),
    };

    console.log("Inserting artifact:", newArtifact);

    const result = await artifactsCollection.insertOne(newArtifact);

    console.log("Artifact inserted:", result.insertedId);

    res.status(201).json({
      success: true,
      message: "Artifact added successfully",
      insertedId: result.insertedId,
      artifact: {
        ...newArtifact,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create artifact error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to add artifact",
      error: error.message,
    });
  }
});

// =========================
// GET ALL ARTIFACTS
// =========================

app.get("/artifacts", async (req, res) => {
  try {
    const { search } = req.query;

    let query = {};

    if (search?.trim()) {
      query = {
        name: {
          $regex: search.trim(),
          $options: "i",
        },
      };
    }

    const artifacts = await artifactsCollection
      .find(query)
      .sort({ createdAtTimestamp: -1 })
      .toArray();

    res.json(artifacts);
  } catch (error) {
    console.error("Get artifacts error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch artifacts",
    });
  }
});

// =========================
// GET MY ARTIFACTS
// =========================

app.get("/my-artifacts", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;

    const artifacts = await artifactsCollection
      .find({
        adderEmail: email,
      })
      .sort({ createdAtTimestamp: -1 })
      .toArray();

    res.json(artifacts);
  } catch (error) {
    console.error("Get my artifacts error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch your artifacts",
    });
  }
});

// =========================
// GET SINGLE ARTIFACT
// =========================

app.get("/artifacts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid artifact ID",
      });
    }

    const artifact = await artifactsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!artifact) {
      return res.status(404).json({
        success: false,
        message: "Artifact not found",
      });
    }

    let isLiked = false;

    if (email) {
      const liked = await likedArtifactsCollection.findOne({
        userEmail: email,
        artifactId: id,
      });

      isLiked = !!liked;
    }

    res.json({
      ...artifact,
      isLiked,
    });
  } catch (error) {
    console.error(" Get single artifact error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch artifact",
    });
  }
});

// =========================
// UPDATE ARTIFACT
// =========================

app.put("/artifacts/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid artifact ID",
      });
    }

    const query = {
      _id: new ObjectId(id),
    };

    const artifact = await artifactsCollection.findOne(query);

    if (!artifact) {
      return res.status(404).json({
        success: false,
        message: "Artifact not found",
      });
    }

    if (artifact.adderEmail !== req.user.email) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own artifact",
      });
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
        presentLocation: updatedData.presentLocation,
        updatedAt: new Date(),
      },
    };

    const result = await artifactsCollection.updateOne(
      query,
      updateDoc
    );

    res.json({
      success: true,
      message: "Artifact updated successfully",
      result,
    });
  } catch (error) {
    console.error("Update artifact error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update artifact",
    });
  }
});

// =========================
// DELETE ARTIFACT
// =========================

app.delete("/artifacts/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid artifact ID",
      });
    }

    const query = {
      _id: new ObjectId(id),
    };

    const artifact = await artifactsCollection.findOne(query);

    if (!artifact) {
      return res.status(404).json({
        success: false,
        message: "Artifact not found",
      });
    }

    if (artifact.adderEmail !== req.user.email) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own artifact",
      });
    }

    const result = await artifactsCollection.deleteOne(query);

    // Delete all likes associated with this artifact
    await likedArtifactsCollection.deleteMany({
      artifactId: id,
    });

    res.json({
      success: true,
      message: "Artifact deleted successfully",
      result,
    });
  } catch (error) {
    console.error("Delete artifact error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete artifact",
    });
  }
});

// =========================
// LIKE / UNLIKE ARTIFACT
// =========================

app.post("/artifacts/:id/like", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.user.email;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid artifact ID",
      });
    }

    const query = {
      _id: new ObjectId(id),
    };

    const artifact = await artifactsCollection.findOne(query);

    if (!artifact) {
      return res.status(404).json({
        success: false,
        message: "Artifact not found",
      });
    }

    const existingLike = await likedArtifactsCollection.findOne({
      userEmail: email,
      artifactId: id,
    });

    let newCount = artifact.likeCount || 0;
    let liked = false;

    if (existingLike) {
      await likedArtifactsCollection.deleteOne({
        userEmail: email,
        artifactId: id,
      });

      newCount = Math.max(0, newCount - 1);
      liked = false;
    } else {
      await likedArtifactsCollection.insertOne({
        userEmail: email,
        artifactId: id,
        createdAt: new Date(),
      });

      newCount += 1;
      liked = true;
    }

    await artifactsCollection.updateOne(query, {
      $set: {
        likeCount: newCount,
      },
    });

    res.json({
      success: true,
      liked,
      likeCount: newCount,
    });
  } catch (error) {
    console.error("Like error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to like artifact",
    });
  }
});

// =========================
// GET LIKED ARTIFACTS
// =========================

app.get("/liked-artifacts", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;

    const likes = await likedArtifactsCollection
      .find({
        userEmail: email,
      })
      .toArray();

    if (!likes.length) {
      return res.json([]);
    }

    const artifactIds = likes
      .map((like) => {
        if (ObjectId.isValid(like.artifactId)) {
          return new ObjectId(like.artifactId);
        }

        return null;
      })
      .filter(Boolean);

    if (!artifactIds.length) {
      return res.json([]);
    }

    const artifacts = await artifactsCollection
      .find({
        _id: {
          $in: artifactIds,
        },
      })
      .toArray();

    res.json(artifacts);
  } catch (error) {
    console.error("Get liked artifacts error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch liked artifacts",
    });
  }
});

// =========================
// Cached DB Connection Logic
// =========================

let dbConnectionPromise = null;

async function connectDB() {
  if (dbConnectionPromise) {
    return dbConnectionPromise;
  }

  dbConnectionPromise = (async () => {
    // Connect to MongoDB
    await client.connect();
    console.log("Successfully connected to MongoDB!");

    const database = client.db("Historical_Artifacts");
    console.log("🗄️ Database:", "Historical_Artifacts");

    // =========================
    // Create Artifacts Collection
    // =========================
    try {
      await database.createCollection("Artifacts");
      console.log("Collection created: Artifacts");
    } catch (error) {
      if (error.codeName === "NamespaceExists" || error.code === 48) {
        console.log("ℹ️ Collection already exists: Artifacts");
      } else {
        throw error;
      }
    }

    // =========================
    // Create LikedArtifacts Collection
    // =========================
    try {
      await database.createCollection("LikedArtifacts");
      console.log("Collection created: LikedArtifacts");
    } catch (error) {
      if (error.codeName === "NamespaceExists" || error.code === 48) {
        console.log("ℹ️ Collection already exists: LikedArtifacts");
      } else {
        throw error;
      }
    }

    // =========================
    // Connect Collections
    // =========================
    artifactsCollection = database.collection("Artifacts");
    likedArtifactsCollection = database.collection("LikedArtifacts");

    console.log("🔗 Artifacts collection connected.");
    console.log("🔗 LikedArtifacts collection connected.");

    // =========================
    // Auto-seed Initial Data if empty
    // =========================
    try {
      const count = await artifactsCollection.countDocuments();
      if (count === 0) {
        console.log("ℹ️ Artifacts collection is empty. Auto-seeding initial data...");
        const fs = require("fs");
        const path = require("path");
        const dbFile = path.resolve(__dirname, "db.json");
        if (fs.existsSync(dbFile)) {
          const dbData = JSON.parse(fs.readFileSync(dbFile, "utf8"));
          const seedArtifacts = dbData.Artifacts || [];
          if (seedArtifacts.length > 0) {
            const preparedSeeds = seedArtifacts.map(art => {
              const seedDoc = { ...art };
              if (seedDoc._id) {
                try {
                  seedDoc._id = new ObjectId(seedDoc._id);
                } catch (e) {
                  delete seedDoc._id;
                }
              }
              seedDoc.createdAtTimestamp = new Date();
              return seedDoc;
            });
            await artifactsCollection.insertMany(preparedSeeds);
            console.log(`Seeded ${preparedSeeds.length} artifacts into database.`);
          }
        }
      }
    } catch (seedError) {
      console.error("Failed to auto-seed initial database data:", seedError.message);
    }

    // =========================
    // Create Indexes
    // =========================
    try {
      // Prevent the same user from liking the same artifact twice
      await likedArtifactsCollection.createIndex(
        {
          userEmail: 1,
          artifactId: 1,
        },
        {
          unique: true,
        }
      );

      // Faster search for user's own artifacts
      await artifactsCollection.createIndex({
        adderEmail: 1,
      });

      // Faster lookup for liked artifacts
      await likedArtifactsCollection.createIndex({
        userEmail: 1,
      });

      console.log("MongoDB indexes are ready.");
    } catch (indexError) {
      console.warn("Warning: Failed to create some MongoDB indexes:", indexError.message);
    }
  })();

  return dbConnectionPromise;
}

// =========================
// DB Connection Middleware
// =========================
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("Database connection failed in middleware:", error);
    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// =========================
// Start Server (Local Only)
// =========================
if (require.main === module) {
  connectDB()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server is running successfully on port ${port}`);
        console.log("==========================================");
        console.log("Database: Historical_Artifacts");
        console.log("Collection: Artifacts");
        console.log("Collection: LikedArtifacts");
        console.log("==========================================");
      });
    })
    .catch((error) => {
      console.error("MongoDB connection failed:");
      console.error(error);
      process.exit(1);
    });
}

// =========================
// Export App for Vercel
// =========================
module.exports = app;