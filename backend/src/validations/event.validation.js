const { z } = require('zod');

exports.createEventSchema = z.object({
    title: z.string().min(3, 'Başlıq minimum 3 simvol olmalıdır'),
    description: z.string().optional(),
    start_date: z.string().datetime('Yalnız keçərli ISO 8601 tarix formatı icazəlidir'),
    end_date: z.string().datetime('Yalnız keçərli ISO 8601 tarix formatı icazəlidir')
}).refine((data) => new Date(data.end_date) > new Date(data.start_date), {
    message: "Bitiş tarixi başlama tarixindən sonra olmalıdır",
    path: ["end_date"]
});
