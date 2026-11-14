create extension if not exists pg_cron;
select cron.schedule('toexcellence-expire', '* * * * *', 'select study.expire()');
