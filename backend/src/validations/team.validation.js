const { z } = require('zod');

exports.createTeamSchema = z.object({
    name: z.string().min(3, 'Komanda adı minimum 3 simvol olmalıdır'),
    event_id: z.number().int().positive('Tədbir ID-si rəqəm olmalıdır və mütləqdir')
});

exports.joinTeamSchema = z.object({
    join_code: z.string().min(6, 'Join code yanlışdır').max(20, 'Join code çox uzundur')
});
