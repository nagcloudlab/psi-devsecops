const request = require('supertest');
const app = require('../src/index');

describe('Product API', () => {
  test('GET /api/products returns product list', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/products/:id returns a product', async () => {
    const res = await request(app).get('/api/products/p1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Laptop');
  });

  test('GET /api/products/:id returns 404 for missing product', async () => {
    const res = await request(app).get('/api/products/nonexistent');
    expect(res.status).toBe(404);
  });

  test('POST /api/products creates a new product', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ name: 'Keyboard', price: 49.99, stock: 100 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Keyboard');
    expect(res.body.id).toBeDefined();
  });

  test('POST /api/products rejects invalid data', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ name: '', price: -10, stock: -1 });
    expect(res.status).toBe(400);
  });

  test('GET /health returns UP', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
  });
});
