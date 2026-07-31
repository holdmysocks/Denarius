FROM postgres:15-alpine

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# Sole automatic database backup: daily at 02:00.
# BusyBox crond reads root's schedule from /etc/crontabs/root.
RUN mkdir -p /etc/crontabs && \
    echo "0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" > /etc/crontabs/root

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["crond", "-f", "-d", "8"]
