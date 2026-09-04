package com.example.order.service;

import com.example.order.model.Order;
import com.example.order.repository.OrderRepository;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;

@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final RestTemplate restTemplate;

    public OrderService(OrderRepository orderRepository, RestTemplate restTemplate) {
        this.orderRepository = orderRepository;
        this.restTemplate = restTemplate;
    }

    public List<Order> getAllOrders() {
        return orderRepository.findAll();
    }

    public Order getOrderById(Long id) {
        return orderRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Order not found: " + id));
    }

    public Order createOrder(Order order) {
        // Call product-service to validate product and get price
        String productUrl = "http://product-service:3000/api/products/" + order.getProductId();
        var product = restTemplate.getForObject(productUrl, java.util.Map.class);

        if (product != null && product.get("price") != null) {
            double price = ((Number) product.get("price")).doubleValue();
            order.setTotalPrice(price * order.getQuantity());
        }

        order.setStatus(Order.OrderStatus.CONFIRMED);
        return orderRepository.save(order);
    }

    public void deleteOrder(Long id) {
        orderRepository.deleteById(id);
    }
}
