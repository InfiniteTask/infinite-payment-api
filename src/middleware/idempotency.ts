import { Response, NextFunction, RequestHandler } from "express";
import { IdempotentRequest } from "../types";
import { requestsCollection } from "../database";

export const idempotencyMiddleware: RequestHandler = async (
  req: IdempotentRequest,
  res: Response,
  next: NextFunction
) => {
  const idempotencyKey = req.headers["idempotency-key"] as string;

  if (!idempotencyKey) {
    res.status(400).json({ error: "Idempotency key required" });
    return;
  }

  // Check if this request was already processed
  const existingRequest = await requestsCollection.findOne({ idempotencyKey });
  if (existingRequest) {
    res.status(200).json(existingRequest.response);
    return;
  }

  req.idempotencyKey = idempotencyKey;
  next();
};
