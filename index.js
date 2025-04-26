import express from "express";
import dotenv from "dotenv";
import { Client, Databases, Query } from "node-appwrite";
import nodemailer from "nodemailer";
import hbs from "nodemailer-express-handlebars";
import path from "path";

dotenv.config();
const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    next();
  }
);
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID);

const databases = new Databases(client);

transporter.use(
  "compile",
  hbs({
    viewEngine: {
      extName: ".hbs",
      partialsDir: path.resolve("./templates"),
      defaultLayout: false,
    },
    viewPath: path.resolve("./templates"),
    extName: ".hbs",
  })
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.post("/webhook/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  if (event.type === "payment_intent.created") {
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    try {
      const databaseId = process.env.APPWRITE_DATABASE_ID;
      const collectionId = process.env.APPWRITE_PAYMENT_COLLECTION_ID;

      const response = await databases.listDocuments(databaseId, collectionId, [
        Query.equal("payment_id", paymentIntent.id),
      ]);

      if (response.documents.length > 0) {
        const paymentDoc = response.documents[0];

        await databases.updateDocument(
          databaseId,
          collectionId,
          paymentDoc.$id,
          {
            success: true,
          }
        );

        transporter.sendMail({
          from: `"Your Company" <${process.env.EMAIL_USER}>`,
          to: paymentDoc.owner.email,
          subject: "Payment Confirmation",
          template: "payment-confirmation",
          context: {
            email: paymentDoc.owner.email,
            amount: (paymentIntent.amount / 100).toFixed(2),
            label: paymentDoc.label,
            size: paymentDoc.size,
          },
        });
      } else {
        console.warn(
          `No payment record found for payment_id=${paymentIntent.id}`
        );
      }
    } catch (error) {
      console.error("Error processing payment_intent.succeeded:", error);
    }
  }

  res.status(200).send("Received webhook event");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
