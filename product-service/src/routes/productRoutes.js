const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// In-memory store (replace with DB in production)
const products = new Map();

// Seed sample data
products.set('p1', { id: 'p1', name: 'Laptop', price: 999.99, stock: 50 });
products.set('p2', { id: 'p2', name: 'Mouse', price: 29.99, stock: 200 });

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.get('/', (req, res) => {
  res.json(Array.from(products.values()));
});

router.get('/:id',
  param('id').trim().escape(),
  validate,
  (req, res) => {
    const product = products.get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  }
);

router.post('/',
  body('name').trim().notEmpty().escape(),
  body('price').isFloat({ min: 0 }),
  body('stock').isInt({ min: 0 }),
  validate,
  (req, res) => {
    const product = {
      id: uuidv4(),
      name: req.body.name,
      price: req.body.price,
      stock: req.body.stock,
    };
    products.set(product.id, product);
    res.status(201).json(product);
  }
);

router.delete('/:id',
  param('id').trim().escape(),
  validate,
  (req, res) => {
    if (!products.has(req.params.id)) {
      return res.status(404).json({ error: 'Product not found' });
    }
    products.delete(req.params.id);
    res.status(204).end();
  }
);

module.exports = router;
