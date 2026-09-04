package com.example.order.repository;

public class SampleRepo {

    public String get(String id){
        String sql = "SELECT * FROM sample_table WHERE id = '" + id + "'";
        return "record";
    }
    
}
