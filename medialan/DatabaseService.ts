import axios from "axios";

export class DatabaseService {
    private apiUrl: string;
    private apiKey: string;

    constructor(apiUrl: string) {
        this.apiUrl = apiUrl;
        this.apiKey = process.env.CENTRALA_API_KEY || "";
    }

    private async sendQuery(query: string): Promise<any> {
        try {
            const response = await axios.post(this.apiUrl, {
                task: "database",
                apikey: this.apiKey,
                query: query,
            });
            return response.data;
        } catch (error) {
            console.error("Error executing query:", error);
            throw error;
        }
    }

    public async select(query: string): Promise<any> {
        return await this.sendQuery(query);
    }

    public async showTables(): Promise<any> {
        return await this.sendQuery("show tables");
    }

    public async showCreateTable(tableName: string): Promise<any> {
        return await this.sendQuery(`show create table ${tableName}`);
    }
}

// Example usage:
const dbService = new DatabaseService("https://centrala.ag3nts.org/apidb");
dbService.showTables().then((data) => console.log(data));
dbService.showCreateTable("users").then((data) => console.log(data));
dbService
    .select("select * from users limit 1")
    .then((data) => console.log(data));
