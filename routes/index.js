var express = require('express');
var md = require('marked').Markdown;
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res) {
  res.render('index', { title: 'Express' , md: md});
});

module.exports = router;
