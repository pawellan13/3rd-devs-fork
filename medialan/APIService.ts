import axios from "axios";

export class ApiService {
    private readonly apiKey: string;
    private readonly apiPeopleURL: string;
    private readonly apiPlaceURL: string;

    constructor() {
        this.apiKey = process.env.CENTRALA_API_KEY || "";
        this.apiPeopleURL = "https://centrala.ag3nts.org/people";
        this.apiPlaceURL = "https://centrala.ag3nts.org/places";
    }

    async fetchDataPeople(query: string) {
        console.log(
            `🔄 Szukam członka ruchu oporu 👤 ${query} from API: https://centrala.ag3nts.org/people`
        );
        try {
            const response = await axios.post(this.apiPeopleURL, {
                apikey: this.apiKey,
                query: query,
            });
            return response.data.message;
        } catch (error) {
            console.error("❌ Error fetching people data from API");
        }
    }

    async fetchDataPlaces(query: string) {
        console.log(
            `🔄 Czy w tym miejscu widziano członka ruchu oporu 📍 ${query} from API: https://centrala.ag3nts.org/places`
        );
        try {
            const response = await axios.post(this.apiPlaceURL, {
                apikey: this.apiKey,
                query: query,
            });
            return response.data.message;
        } catch (error) {
            console.error("❌ Error fetching place data from API");
        }
    }
}
