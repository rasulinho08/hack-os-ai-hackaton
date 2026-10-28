-- 0009 — give unassigned events to the customer their creator belongs to.
--
-- Until now any organiser could see every event with no customer, a
-- changeover rule from 0007. Self-serve checkout makes anyone on the internet
-- an organiser, so that rule let a stranger read and change other people's
-- events. The API no longer applies it; this migration keeps access for the
-- people who should have it: an event whose creator is a contact of exactly
-- one customer now belongs to that customer, so the creator's colleagues
-- still see it.
--
-- Events whose creator belongs to no customer, or to several, stay
-- unassigned: their creator still sees them, and the platform owner assigns
-- them from the console.

UPDATE events e
   SET customer_id = sole.customer_id
  FROM (
        SELECT cc.user_id, MIN(cc.customer_id) AS customer_id
          FROM customer_contacts cc
          JOIN customers c ON c.id = cc.customer_id
         WHERE cc.user_id IS NOT NULL
         GROUP BY cc.user_id
        HAVING COUNT(DISTINCT cc.customer_id) = 1
       ) sole
 WHERE e.customer_id IS NULL
   AND e.created_by = sole.user_id;
