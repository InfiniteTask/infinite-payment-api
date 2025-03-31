import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { messageQueue } from "../services/messageQueueService";
import {
  getWiseQuote,
  fetchAccountDetails,
  fetchRecipients
} from "../services/wiseService";
import {
  paymentsCollection,
  requestsCollection,
  eventsCollection
} from "../database";
import {
  PaymentRequest,
  PaymentResponse,
  PaymentEvent,
  IdempotentRequest
} from "../types";

const router = Router();

// Payment endpoint with idempotency
router.post(
  "/",
  idempotencyMiddleware,
  async (req: IdempotentRequest, res: Response) => {
    try {
      console.log(req.body, "req body in payments");
      const { amount, currency, customerId } = req.body as PaymentRequest;
      const paymentId = uuidv4();

      // Fetch account details from Wise
      await fetchAccountDetails();

      // Fetch recipients from Wise
      const recipientsData = await fetchRecipients();

      if (!recipientsData.content || recipientsData.content.length === 0) {
        throw new Error("No recipients found");
      }

      // Get quote from Wise
      const quote = await getWiseQuote(
        currency,
        "INR",
        amount,
        recipientsData.content[0].id,
        Number(process.env.WISE_PROFILE_ID)
      );

      console.log(quote, "quote from wise");

      // Store payment in database
      await paymentsCollection.insertOne({
        paymentId,
        amount,
        currency,
        customerId: recipientsData.content[0].id,
        wisePaymentId: quote.id, // Storing quote ID
        status: "succeeded", // Assuming quote retrieval means success
        createdAt: new Date()
      });

      // Publish event to queue
      const paymentEvent: PaymentEvent = {
        event: "payment.created",
        data: {
          paymentId,
          amount,
          currency,
          customerId: recipientsData.content[0].id,
          wisePaymentId: quote.id, // Quote ID
          status: "succeeded"
        }
      };

      await messageQueue.sendMessage("payment_events", paymentEvent);

      // Store request and response for idempotency
      const response: PaymentResponse = { paymentId, status: "processing" };
      await requestsCollection.insertOne({
        idempotencyKey: req.idempotencyKey as string,
        response,
        createdAt: new Date()
      });

      res.status(202).json(response);
    } catch (error) {
      console.error("Payment error:", error);
      res.status(500).json({ error: "Payment processing failed" });
    }
  }
);

// Get all payments
router.get("/", async (req: Request, res: Response) => {
  try {
    const payments = await paymentsCollection.find().toArray();
    res.json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

// Get payment by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const payment = await paymentsCollection.findOne({
      paymentId: req.params.id
    });
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
    }
    res.json(payment);
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({ error: "Failed to fetch payment" });
  }
});

// Endpoint to view stored events (for development)
router.get("/events", async (req: Request, res: Response) => {
  try {
    const events = await eventsCollection.find().toArray();
    res.json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

export default router;
