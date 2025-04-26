import express from "express";
import dotenv from "dotenv";

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

app.post("/webhook/stripe", (req, res) => {
  console.log("Received webhook event:", req.rawBody);

  res.status(200).send("Received webhook event");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
