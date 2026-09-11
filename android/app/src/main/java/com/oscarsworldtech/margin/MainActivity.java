package com.oscarsworldtech.margin;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super so the bridge sees it while loading the web layer.
        registerPlugin(MarginPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
