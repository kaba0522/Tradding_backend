var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var cors = require('cors');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var v1Router = require('./routes/v1');

var app = express();

// CORS_ORIGIN is a comma-separated whitelist (e.g. "https://admin.example.com,http://localhost:5173").
// Left unset it allows any origin — fine for now since auth is bearer-token (no cookies), no
var corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(function (origin) { return origin.trim(); })
  : true;

app.use(cors({ origin: corsOrigins }));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/api/v1', v1Router);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.json({
    message: err.message,
    error: req.app.get('env') === 'development' ? err.stack : undefined,
  });
});

module.exports = app;
