#!/usr/bin/env python3
import psutil
import paho.mqtt.client as mqtt
import time
import json

MQTT_BROKER = "192.168.0.106"  # ← juster ved behov
MQTT_TOPIC = "shellies/status/sut"
CHECK_INTERVAL = 5  # sekunder mellem målinger
MAX_INTERVAL = 60  # sekunder mellem tvungne send

CPU_THRESHOLD = 5.0        # % ændring
NET_THRESHOLD = 1024 * 100  # 100 KB ændring

last_cpu = psutil.cpu_percent(interval=1)
last_net = psutil.net_io_counters()
last_send_time = time.time()

client = mqtt.Client()
client.connect(MQTT_BROKER, 1883, 60)

while True:
    time.sleep(CHECK_INTERVAL)

    cpu = psutil.cpu_percent(interval=None)
    net = psutil.net_io_counters()
    now = time.time()
    interval = now - last_send_time

    # udregn ændringer og hastighed i KB/s
    net_recv_diff = net.bytes_recv - last_net.bytes_recv
    net_sent_diff = net.bytes_sent - last_net.bytes_sent

    net_recv_rate = net_recv_diff / interval / 1024  # KB/s
    net_sent_rate = net_sent_diff / interval / 1024  # KB/s

    cpu_diff = abs(cpu - last_cpu)

    send_due_to_time = interval >= MAX_INTERVAL
    send_due_to_change = (
        cpu_diff > CPU_THRESHOLD or
        net_recv_diff > NET_THRESHOLD or
        net_sent_diff > NET_THRESHOLD
    )

    if send_due_to_change or send_due_to_time:
        payload = {
            "cpu": round(cpu, 1),
            "net": {
                "recv": round(net_recv_rate, 1),
                "sent": round(net_sent_rate, 1),
                "total": {
                    "recv": net.bytes_recv,
                    "sent": net.bytes_sent
                }
            },
            "timestamp": int(now)
        }

        client.publish(MQTT_TOPIC, json.dumps(payload))
        print("Sent:", json.dumps(payload, indent=2))

        last_cpu = cpu
        last_net = net
        last_send_time = now
