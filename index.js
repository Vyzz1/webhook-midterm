import express from "express";
import dotenv from "dotenv";
import { Client, Databases, Query } from "node-appwrite";
import nodemailer from "nodemailer";
import hbs from "nodemailer-express-handlebars";
import path from "path";
import Stripe from "stripe";

dotenv.config();
const app = express();

app.use("/webhook/stripe", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;

    try {
      const databaseId = process.env.APPWRITE_DATABASE_ID;
      const paymentCollectionId = process.env.APPWRITE_PAYMENT_COLLECTION_ID;

      const userCollectionId = process.env.APPWRITE_USERS_COLLECTION_ID;

      if (!databaseId || !paymentCollectionId || !userCollectionId) {
        console.error("Missing required environment variables.");
        return res.status(500).send("Internal Server Error");
      }

      const response = await databases.listDocuments(
        databaseId,
        paymentCollectionId,
        [Query.equal("payment_id", paymentIntent.id)]
      );

      if (response.documents.length > 0) {
        const paymentDoc = response.documents[0];

        await databases.updateDocument(
          databaseId,
          paymentCollectionId,
          paymentDoc.$id,
          {
            success: true,
          }
        );

        let totalMB = 0;

        switch (paymentDoc.size) {
          case "1GB":
            totalMB = 1024;
            break;
          case "500MB":
            totalMB = 512;
            break;
          case "2GB":
            totalMB = 2048;
            break;
          default:
            break;
        }

        await databases.updateDocument(
          databaseId,
          userCollectionId,
          paymentDoc.owner.$id,
          {
            totalStorage:
              paymentDoc.owner.totalStorage !== null
                ? paymentDoc.owner.totalStorage + totalMB
                : totalMB,
          }
        );

        console.log("Updated user storage successfully");

        console.log("sending email to user");

        console.log("sending email to user");
        try {
          const info = await transporter.sendMail({
            from: `"Cloud Storage" <${process.env.EMAIL_USER}>`,
            to: paymentDoc.owner.email,
            subject: "Payment Confirmation",
            template: "payment-confirmation",
            context: {
              fullName: paymentDoc.owner.fullName,
              amount: (paymentIntent.amount / 100).toFixed(2),
              label: paymentDoc.label,
              size: paymentDoc.size,
            },
          });
          console.log("Email sent successfully:", info.response);
        } catch (error) {
          console.error("Error sending email:", error);
        }

        res.status(200).send("Received webhook event");
      } else {
        console.warn(
          `No payment record found for payment_id=${paymentIntent.id}`
        );

        return res.status(404).send("Payment record not found");
      }
    } catch (error) {
      console.error("Error processing payment_intent.created:", error);
    }
  }

  res.status(200).send("Received webhook event");
});
app.get("/test-email", async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: `"Cloud Storage" <${process.env.EMAIL_USER}>`,
      to: "vyauth28@gmail.com", // Use your email for testing
      subject: "Test Email",
      template: "payment-confirmation",
      context: {
        fullName: "Test User",
        amount: "10.00",
        label: "Test Label",
        size: "1GB",
      },
    });
    res.send("Email sent successfully: " + info.response);
  } catch (error) {
    console.error("Error sending test email:", error);
    res.status(500).send("Error sending email: " + error.message);
  }
});

app.get("/test-plain-email", async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: `"Cloud Storage" <${process.env.EMAIL_USER}>`,
      to: "vyauth28@gmail.com",
      subject: "Test Plain Email",
      text: "This is a test email without using templates. If you receive this, we know the template is the issue.",
    });
    res.send("Plain email sent successfully: " + info.response);
  } catch (error) {
    console.error("Error sending test email:", error);
    res.status(500).send("Error sending email: " + error.message);
  }
});
app.get("/", (req, res) => {
  res.send("Hello World! This is the webhook server for Stripe and Appwrite.");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
