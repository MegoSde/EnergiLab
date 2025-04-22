ret og Kopier energy-monitor.service til /etc/systemd/system/

//Genindlæs og aktiver

sudo systemctl daemon-reexec
sudo systemctl enable energy-monitor
sudo systemctl start energy-monitor

