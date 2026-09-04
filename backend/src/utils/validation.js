import { body } from 'express-validator';

// Address validation
export const addressValidation = {
  street: body('address.street')
    .notEmpty().withMessage('Street is required')
    .isString().withMessage('Street must be a string')
    .trim()
    .isLength({ max: 255 }).withMessage('Street must be less than 255 characters'),
  
  landmark: body('address.landmark')
    .optional()
    .isString().withMessage('Landmark must be a string')
    .trim()
    .isLength({ max: 255 }).withMessage('Landmark must be less than 255 characters'),
  
  city: body('address.city')
    .notEmpty().withMessage('City is required')
    .isString().withMessage('City must be a string')
    .trim()
    .isLength({ max: 100 }).withMessage('City must be less than 100 characters'),
  
  district: body('address.district')
    .notEmpty().withMessage('District is required')
    .isString().withMessage('District must be a string')
    .trim()
    .isLength({ max: 100 }).withMessage('District must be less than 100 characters'),
  
  state: body('address.state')
    .notEmpty().withMessage('State is required')
    .isString().withMessage('State must be a string')
    .trim()
    .isLength({ max: 100 }).withMessage('State must be less than 100 characters'),
  
  country: body('address.country')
    .notEmpty().withMessage('Country is required')
    .isString().withMessage('Country must be a string')
    .trim()
    .isLength({ max: 100 }).withMessage('Country must be less than 100 characters'),
  
  pinCode: body('address.pinCode')
    .notEmpty().withMessage('Pin code is required')
    .isString().withMessage('Pin code must be a string')
    .trim()
    .isLength({ min: 6, max: 10 }).withMessage('Pin code must be between 6 and 10 characters')
    .matches(/^[0-9]+$/).withMessage('Pin code must contain only numbers')
};

// Registration validation
export const registerValidation = [
  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email must be less than 255 characters'),
  
  body('phoneNumber')
    .notEmpty().withMessage('Phone number is required')
    .isString().withMessage('Phone number must be a string')
    .trim()
    .isLength({ min: 10, max: 15 }).withMessage('Phone number must be between 10 and 15 characters')
    .matches(/^[0-9]+$/).withMessage('Phone number must contain only numbers'),
  
  body('name')
    .notEmpty().withMessage('Name is required')
    .isString().withMessage('Name must be a string')
    .trim()
    .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
  
  body('password')
    .notEmpty().withMessage('Password is required')
    .isString().withMessage('Password must be a string')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  
  body('confirmPassword')
    .notEmpty().withMessage('Confirm password is required')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match'),
  
  ...Object.values(addressValidation)
];

// Login validation
export const loginValidation = [
  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  body('password')
    .notEmpty().withMessage('Password is required')
    .isString().withMessage('Password must be a string')
];