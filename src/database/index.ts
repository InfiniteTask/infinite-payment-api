import { MongoClient, Collection, Db, ObjectId } from "mongodb";
import { config } from "../config";
import { StoredRequest, StoredEvent } from "../types";

// MongoDB connection
let db: Db;
let requestsCollection: Collection<StoredRequest>;
let eventsCollection: Collection<StoredEvent>;
let paymentsCollection: Collection;
let recipientsCollection: Collection;

async function connectToMongoDB(): Promise<boolean> {
  try {
    const client = new MongoClient(config.mongodb.uri);
    await client.connect();
    console.log("Connected to MongoDB");

    db = client.db(config.mongodb.dbName);
    requestsCollection = db.collection("requests");
    eventsCollection = db.collection("events");
    paymentsCollection = db.collection("payments");
    recipientsCollection = db.collection("recipients");

    // Create indexes for faster queries
    await requestsCollection.createIndex(
      { idempotencyKey: 1 },
      { unique: true }
    );
    await recipientsCollection.createIndex({ customerId: 1 });
    await recipientsCollection.createIndex(
      { wiseAccountId: 1 },
      { unique: true }
    );
    await recipientsCollection.createIndex(
      { wiseProfileId: 1 },
      { unique: true }
    );

    return true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return false;
  }
}

export {
  connectToMongoDB,
  db,
  requestsCollection,
  eventsCollection,
  paymentsCollection,
  recipientsCollection
};
