FROM alpine:3.20

RUN apk add --no-cache bash openssl pandoc python3

WORKDIR /app
COPY . .
RUN ./build.sh

EXPOSE 8080
CMD ["sh", "-c", "python3 -m http.server ${PORT:-8080} --directory dist"]
