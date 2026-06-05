# backend/Dockerfile
FROM node:20-alpine

# Install postgresql-client for pg_dump
RUN apk add --no-cache postgresql-client

WORKDIR /app

# نسخ ملفات الحزم لتثبيت الاعتمادات
COPY package*.json ./

# تثبيت الاعتمادات المخصصة للتشغيل فقط (تفادي devDependencies)
RUN npm ci --omit=dev

# نسخ كود المشروع بالكامل
COPY . .

EXPOSE 5000

CMD ["npm", "start"]
