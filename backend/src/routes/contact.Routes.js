import express from 'express';
import { submitContactForm, submitDemoRequest } from '../controllers/contact.Controller.js';
import { contactFormLimiter } from '../middleware/rateLimit.js';

const contactRouter = express.Router();

// No auth — the marketing site's Contact and Book a Demo forms, open to
// anyone who hasn't signed up yet.
contactRouter.post('/', contactFormLimiter, submitContactForm);
contactRouter.post('/demo', contactFormLimiter, submitDemoRequest);

export default contactRouter;
